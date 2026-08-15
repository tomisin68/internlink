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

/**
 * Document uploads live in `lib/cloudinary.ts` alongside the feed-media path,
 * so both modes (signed and unsigned) are described in one place. Re-exported
 * here because the profile wizards have always imported them from this module.
 */
export { uploadApi, uploadDocument as uploadToCloudinary } from '@/lib/cloudinary';
export type { UploadTicket } from '@/lib/cloudinary';
