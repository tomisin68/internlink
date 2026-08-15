import { z } from 'zod';
import { AccountSchema, InternProfileSchema, CompanySchema, RecruiterProfileSchema } from './entities.js';

/**
 * Every response the API produces is one of these two shapes. Clients branch on
 * `ok` and never have to guess whether a 200 body is data or an error.
 */
export const ApiErrorCodeSchema = z.enum([
  'validation_failed',
  'unauthenticated',
  'token_expired',
  'forbidden',
  'role_not_held',
  'not_found',
  'conflict',
  'email_in_use',
  'rate_limited',
  'account_restricted',
  'verification_required',
  'upstream_unavailable',
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Per-field messages, keyed by dotted form path so RHF can setError directly. */
export const FieldErrorsSchema = z.record(z.string(), z.array(z.string()));
export type FieldErrors = z.infer<typeof FieldErrorsSchema>;

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: ApiErrorCodeSchema,
    /** Safe to show a user as-is. Never contains stack traces or internals. */
    message: z.string(),
    fields: FieldErrorsSchema.optional(),
    /** Correlates a user-reported failure with a server log line. */
    requestId: z.string().optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function apiSuccess<T extends z.ZodTypeAny>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** SRS §3.5 — cursor, never offset. Offset paging breaks as soon as items are
 *  inserted mid-scroll, which is exactly what a listings feed does. */
export const PageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/* --------------------------------------------------------------- payloads - */

/**
 * The single object the web app hydrates its session from. Returned by
 * POST /v1/auth/session and GET /v1/auth/me.
 *
 * `nextStep` is computed server-side so the client never has to re-derive
 * "where should this user land?" — that logic living in two places is how
 * onboarding loops happen.
 */
export const SessionPayloadSchema = z.object({
  account: AccountSchema,
  internProfile: InternProfileSchema.nullable(),
  recruiterProfile: RecruiterProfileSchema.nullable(),
  company: CompanySchema.nullable(),
  nextStep: z.enum([
    'select_role',
    'create_intern_profile',
    'create_recruiter_profile',
    'verify_email',
    'ready',
  ]),
});
export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

export const HealthPayloadSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number(),
  checks: z.record(z.string(), z.enum(['ok', 'fail', 'skipped'])),
});
export type HealthPayload = z.infer<typeof HealthPayloadSchema>;

/** Cloudinary signed-upload handshake (SRS §7.1 — clients never hold secrets). */
export const UploadSignatureSchema = z.object({
  signature: z.string(),
  timestamp: z.number(),
  apiKey: z.string(),
  cloudName: z.string(),
  folder: z.string(),
  uploadPreset: z.string().nullable(),
});
export type UploadSignature = z.infer<typeof UploadSignatureSchema>;

export const UploadKindSchema = z.enum([
  'avatar',
  'company_logo',
  'cv',
  'verification_doc',
  /** Feed carousel content — images and video share one kind and one folder. */
  'post_media',
]);
export type UploadKind = z.infer<typeof UploadKindSchema>;

/**
 * What the client needs to know before offering an uploader.
 *
 * `unsigned` means the account has a public upload preset configured, so the
 * browser can post straight to Cloudinary without asking us to sign anything.
 * That is the only mode that works when the API holds no Cloudinary secret,
 * and it is how feed media uploads stay available in every environment.
 */
export const UploadCapabilitiesSchema = z.object({
  available: z.boolean(),
  signed: z.boolean(),
  unsigned: z.boolean(),
  cloudName: z.string().nullable(),
  uploadPreset: z.string().nullable(),
});
export type UploadCapabilities = z.infer<typeof UploadCapabilitiesSchema>;
