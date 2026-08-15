import type { ApiError, ApiErrorCode, FieldErrors } from '@internlink/shared-types';
import { getIdToken } from './firebase';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/**
 * A failed API call, carrying enough structure for the form layer to place
 * messages on the right inputs rather than dumping one string at the top.
 */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: FieldErrors | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, error: ApiError['error']) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = error.code;
    this.fields = error.fields;
    this.requestId = error.requestId;
    this.retryAfterSeconds = error.retryAfterSeconds;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === 'upstream_unavailable';
  }
}

/** Network-level failure — no response at all. Distinct from a 4xx/5xx. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super(
      navigator.onLine
        ? 'We could not reach InternLink. Check your connection and try again.'
        : "You're offline. We'll retry when you're back.",
    );
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skips the Authorization header. Used for genuinely public reads. */
  anonymous?: boolean;
  /** Internal — guards the single token-refresh retry against looping. */
  _isRetry?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, anonymous, _isRetry, headers, ...init } = options;

  const finalHeaders = new Headers(headers);
  finalHeaders.set('Accept', 'application/json');
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');

  if (!anonymous) {
    // Force a refresh on the retry pass so a token that expired mid-flight is
    // replaced rather than resent.
    const token = await getIdToken(Boolean(_isRetry));
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body on an error status is usually an infrastructure page
    // (502 from the load balancer). Surface it as a clean error, not a parse
    // failure the user cannot act on.
    if (!response.ok) {
      throw new ApiRequestError(response.status, {
        code: response.status >= 500 ? 'internal_error' : 'validation_failed',
        message: 'Something went wrong. Try again in a moment.',
      });
    }
    throw new Error('The server returned an unreadable response.');
  }

  const envelope = payload as { ok?: boolean; data?: T; error?: ApiError['error'] };

  if (!response.ok || envelope.ok === false) {
    const error = envelope.error ?? {
      code: 'internal_error' as ApiErrorCode,
      message: 'Something went wrong. Try again.',
    };

    // One transparent retry when the token has simply aged out. Any further
    // 401 means the session is genuinely gone and the caller should sign out.
    if (error.code === 'token_expired' && !_isRetry) {
      return request<T>(path, { ...options, _isRetry: true });
    }

    throw new ApiRequestError(response.status, error);
  }

  return envelope.data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  // DELETE takes a body here because unregistering a push token identifies it
  // by value, and an FCM token is far too long to put in a URL path safely.
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

/**
 * Maps Firebase Auth's error codes onto the same shape our forms already
 * handle, so the sign-in screen has one error path instead of two.
 *
 * Firebase deliberately returns `invalid-credential` for both "no such user"
 * and "wrong password" — do not try to distinguish them in the copy, that is
 * the anti-enumeration behaviour working as intended.
 */
export function mapFirebaseAuthError(error: unknown): {
  message: string;
  fields?: FieldErrors;
} {
  if (error instanceof ApiRequestError) {
    const suffix = error.requestId ? ` Reference: ${error.requestId}` : '';
    return { message: `${error.message}${suffix}`, fields: error.fields };
  }

  if (error instanceof NetworkError) {
    return { message: error.message };
  }

  const code = (error as { code?: string }).code ?? '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return { message: 'That email and password do not match. Check them and try again.' };
    case 'auth/email-already-in-use':
      return {
        message: 'An account already exists with that email.',
        fields: { email: ['An account already exists with that email.'] },
      };
    case 'auth/invalid-email':
      return { message: 'That email address is not valid.', fields: { email: ['Enter a valid email address'] } };
    case 'auth/weak-password':
      return { message: 'That password is too weak.', fields: { password: ['Choose a stronger password'] } };
    case 'auth/too-many-requests':
      return { message: 'Too many attempts. Wait a few minutes and try again.' };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return { message: '' }; // User backed out on purpose — say nothing.
    case 'auth/popup-blocked':
      return { message: 'Your browser blocked the sign-in window. Allow pop-ups and try again.' };
    case 'auth/network-request-failed':
      return { message: 'We could not reach the sign-in service. Check your connection.' };
    case 'auth/account-exists-with-different-credential':
      return { message: 'You already have an account with that email. Sign in with your password instead.' };
    default:
      return { message: 'We could not sign you in. Try again in a moment.' };
  }
}
