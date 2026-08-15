import type {
  CreateInternProfileInput,
  CreateRecruiterProfileInput,
  SessionPayload,
} from '@internlink/shared-types';
import { api } from '@/lib/api-client';

export const authApi = {
  /** Creates the account on first call, rehydrates it on every call after. */
  exchangeSession: (names?: { firstName?: string; lastName?: string }) =>
    api.post<SessionPayload>('/auth/session', names ?? {}),

  me: () => api.get<SessionPayload>('/auth/me'),

  selectRole: (role: 'intern' | 'recruiter') =>
    api.post<SessionPayload>('/auth/role', { role }),

  switchRole: (role: 'intern' | 'recruiter' | 'admin') =>
    api.post<SessionPayload>('/auth/switch-role', { role }),

  completeOnboarding: () => api.post<SessionPayload>('/auth/complete-onboarding'),

  signOutEverywhere: () => api.post<{ signedOut: boolean }>('/auth/sign-out'),
};

export const profileApi = {
  createInternProfile: (input: CreateInternProfileInput) =>
    api.post<SessionPayload>('/profiles/intern', input),

  createRecruiterProfile: (input: CreateRecruiterProfileInput) =>
    api.post<SessionPayload>('/profiles/recruiter', input),

  completeness: () =>
    api.get<{ score: number; missing: string[] }>('/profiles/intern/me/completeness'),
};

export interface UploadTicket {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  allowedFormats: string[];
  maxBytes: number;
  resourceType: 'image' | 'raw';
}

export const uploadApi = {
  sign: (kind: 'avatar' | 'company_logo' | 'cv' | 'verification_doc', bytes?: number) =>
    api.post<UploadTicket>('/uploads/signature', { kind, bytes }),
};

/**
 * Uploads straight to Cloudinary using a server-issued signature.
 *
 * The file never touches our API — §7.1's whole point — so a 10MB CV does not
 * occupy a Node process for the duration of a slow mobile upload.
 */
export async function uploadToCloudinary(
  file: File,
  kind: 'avatar' | 'company_logo' | 'cv' | 'verification_doc',
  onProgress?: (percent: number) => void,
): Promise<{ url: string; publicId: string }> {
  const ticket = await uploadApi.sign(kind, file.size);

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ticket.allowedFormats.includes(extension)) {
    throw new Error(`That file type is not supported. Use ${ticket.allowedFormats.join(', ')}.`);
  }
  if (file.size > ticket.maxBytes) {
    throw new Error(`That file is too large. Maximum ${Math.round(ticket.maxBytes / 1024 / 1024)}MB.`);
  }

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', ticket.apiKey);
  form.append('timestamp', String(ticket.timestamp));
  form.append('signature', ticket.signature);
  form.append('folder', ticket.folder);
  form.append('allowed_formats', ticket.allowedFormats.join(','));

  const endpoint = `https://api.cloudinary.com/v1_1/${ticket.cloudName}/${ticket.resourceType}/upload`;

  // XHR rather than fetch: fetch still cannot report upload progress, and a CV
  // upload on a 3G connection without a progress bar feels broken.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = JSON.parse(xhr.responseText) as { secure_url: string; public_id: string };
        resolve({ url: body.secure_url, publicId: body.public_id });
      } else {
        reject(new Error('The upload failed. Try again.'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('The upload failed. Check your connection.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

    xhr.send(form);
  });
}
