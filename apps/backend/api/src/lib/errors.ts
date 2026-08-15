import type { ApiErrorCode, FieldErrors } from '@internlink/shared-types';

/**
 * The only error type route handlers should throw.
 *
 * Anything else reaching the error handler is treated as a bug and reported to
 * the client as a generic `internal_error` — so an accidental
 * `TypeError: cannot read property 'cacNumber' of undefined` never leaks a
 * schema detail to a caller.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields?: FieldErrors;
  readonly retryAfterSeconds?: number;
  /** Detail for the log line only — never serialised into a response. */
  readonly internal?: unknown;

  constructor(opts: {
    status: number;
    code: ApiErrorCode;
    message: string;
    fields?: FieldErrors;
    retryAfterSeconds?: number;
    internal?: unknown;
  }) {
    super(opts.message);
    this.name = 'AppError';
    this.status = opts.status;
    this.code = opts.code;
    this.fields = opts.fields;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.internal = opts.internal;
    Error.captureStackTrace?.(this, AppError);
  }
}

/* Messages here are shown verbatim to users, so they are written as copy:
   plain, specific, and never blaming the person reading them. */

export const badRequest = (message: string, fields?: FieldErrors) =>
  new AppError({ status: 400, code: 'validation_failed', message, fields });

export const unauthenticated = (message = 'Sign in to continue.') =>
  new AppError({ status: 401, code: 'unauthenticated', message });

export const tokenExpired = (message = 'Your session has expired. Sign in again.') =>
  new AppError({ status: 401, code: 'token_expired', message });

export const forbidden = (message = 'You do not have access to this.') =>
  new AppError({ status: 403, code: 'forbidden', message });

export const roleNotHeld = (role: string) =>
  new AppError({
    status: 403,
    code: 'role_not_held',
    message: `You do not have a ${role} profile yet.`,
  });

export const notFound = (what = 'That') =>
  new AppError({ status: 404, code: 'not_found', message: `${what} could not be found.` });

export const conflict = (message: string) =>
  new AppError({ status: 409, code: 'conflict', message });

export const emailInUse = () =>
  new AppError({
    status: 409,
    code: 'email_in_use',
    message: 'An account already exists with that email.',
    fields: { email: ['An account already exists with that email.'] },
  });

export const rateLimited = (retryAfterSeconds: number) =>
  new AppError({
    status: 429,
    code: 'rate_limited',
    message: 'Too many attempts. Try again shortly.',
    retryAfterSeconds,
  });

export const accountRestricted = (message: string) =>
  new AppError({ status: 403, code: 'account_restricted', message });

export const verificationRequired = (message: string) =>
  new AppError({ status: 403, code: 'verification_required', message });

export const upstreamUnavailable = (service: string, internal?: unknown) =>
  new AppError({
    status: 503,
    code: 'upstream_unavailable',
    message: `${service} is unavailable right now. Try again in a moment.`,
    internal,
  });

export const internalError = (internal?: unknown) =>
  new AppError({
    status: 500,
    code: 'internal_error',
    message: 'Something went wrong on our end. Try again.',
    internal,
  });
