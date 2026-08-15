import { z } from 'zod';
import {
  AvailabilitySchema,
  ProfileVisibilitySchema,
  RoleSchema,
  WorkModeSchema,
} from './enums.js';
import {
  CertificationSchema,
  EducationEntrySchema,
  ExperienceEntrySchema,
  PortfolioLinkSchema,
} from './entities.js';

/* ============================================================================
   These schemas are consumed twice: the backend validates request bodies with
   them, and the web app feeds them straight into react-hook-form via
   zodResolver. Every message here is user-facing copy — write it as such.
   ============================================================================ */

/** Names: allow letters, marks, spaces, apostrophes and hyphens. Rejects digits
 *  and symbols without being hostile to Yoruba/Igbo diacritics or names like
 *  O'Brien and Ade-Kunle. */
const personNameRegex = /^[\p{L}\p{M}][\p{L}\p{M}'\-. ]*$/u;

export const nameField = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(60, `${label} must be 60 characters or fewer`)
    .regex(personNameRegex, `${label} can only contain letters, hyphens and apostrophes`);

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .email('Enter a valid email address');

/**
 * Length-first password policy. Deliberately no "must contain a symbol" rule:
 * composition rules push people toward `Password1!` while a 10-char floor plus
 * a mixed-character requirement gives more real entropy for less friction.
 */
export const passwordField = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[a-zA-Z]/.test(v), 'Include at least one letter')
  .refine((v) => /[0-9!@#$%^&*(),.?":{}|<>_\-+=[\]\\/~`]/.test(v), 'Include a number or symbol');

/* ------------------------------------------------------------------ auth -- */

export const RegisterSchema = z.object({
  firstName: nameField('First name'),
  lastName: nameField('Last name'),
  email: emailField,
  password: passwordField,
  /** Chosen on the role screen right after sign-up; admin can never be picked. */
  intendedRole: z.enum(['intern', 'recruiter']).default('intern'),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You need to accept the terms to continue' }),
  }),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

/** Client-side only: adds the confirm-password cross-field check. The API never
 *  receives `confirmPassword`, so it lives here rather than in RegisterSchema. */
export const RegisterFormSchema = RegisterSchema.extend({
  confirmPassword: z.string().min(1, 'Confirm your password'),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});
export type RegisterFormInput = z.infer<typeof RegisterFormSchema>;

export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean().default(true),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const PasswordResetRequestSchema = z.object({ email: emailField });
export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestSchema>;

/** FR-103 — switching role mints a new token, no re-authentication. */
export const SwitchRoleSchema = z.object({
  role: z.enum(['intern', 'recruiter', 'admin']),
});
export type SwitchRoleInput = z.infer<typeof SwitchRoleSchema>;

/**
 * Exchanges a verified Firebase identity for an InternLink session.
 *
 * The ID token travels in the `Authorization: Bearer` header like every other
 * authenticated call — not in the body — so there is exactly one place the API
 * reads credentials from. The names here are sent only on the first exchange
 * after sign-up, where the client knows the first/last split and the provider
 * does not.
 */
export const SessionExchangeSchema = z.object({
  firstName: nameField('First name').optional(),
  lastName: nameField('Last name').optional(),
});
export type SessionExchangeInput = z.infer<typeof SessionExchangeSchema>;

/* --------------------------------------------------------------- profile -- */

/** Step 1 of the intern wizard — identity and headline. */
export const InternBasicsSchema = z.object({
  headline: z
    .string()
    .trim()
    .min(10, 'Say a little more — at least 10 characters')
    .max(140, 'Keep it under 140 characters'),
  location: z.string().trim().min(2, 'Where are you based?').max(120),
  photoUrl: z.string().url().nullable().optional(),
});
export type InternBasicsInput = z.infer<typeof InternBasicsSchema>;

/** Step 2 — education. */
export const InternEducationSchema = z.object({
  school: z.string().trim().min(2, 'Enter your school').max(160),
  education: z.array(EducationEntrySchema.omit({ id: true })).max(12).default([]),
});
export type InternEducationInput = z.infer<typeof InternEducationSchema>;

/** Step 3 — skills and availability. The 3-skill floor is what makes the
 *  "Matches for you" feed (FR-204) worth rendering at all. */
export const InternSkillsSchema = z.object({
  skills: z
    .array(z.string().trim().min(1).max(48))
    .min(3, 'Add at least 3 skills so we can match you to roles')
    .max(30, 'That is plenty — 30 skills maximum'),
  availability: AvailabilitySchema,
  preferredWorkModes: z
    .array(WorkModeSchema)
    .min(1, 'Pick at least one way you would like to work'),
});
export type InternSkillsInput = z.infer<typeof InternSkillsSchema>;

/** Step 4 — CV, links, about. All optional: a wizard that blocks on a CV upload
 *  loses people who are signing up from a phone without one to hand. */
export const InternDetailsSchema = z.object({
  about: z.string().trim().max(2600).nullable().optional(),
  cvUrl: z.string().url('That does not look like a valid link').nullable().optional(),
  cvFileName: z.string().max(200).nullable().optional(),
  portfolioLinks: z.array(PortfolioLinkSchema).max(6).default([]),
  experience: z.array(ExperienceEntrySchema.omit({ id: true })).max(20).default([]),
  certifications: z.array(CertificationSchema.omit({ id: true })).max(20).default([]),
  openToOpportunities: z.boolean().default(true),
  visibility: ProfileVisibilitySchema.default('public'),
});
export type InternDetailsInput = z.infer<typeof InternDetailsSchema>;

/** Whole-wizard payload — what gets POSTed when the user finishes. */
export const CreateInternProfileSchema = InternBasicsSchema.merge(InternEducationSchema)
  .merge(InternSkillsSchema)
  .merge(InternDetailsSchema);
export type CreateInternProfileInput = z.infer<typeof CreateInternProfileSchema>;

export const UpdateInternProfileSchema = CreateInternProfileSchema.partial();
export type UpdateInternProfileInput = z.infer<typeof UpdateInternProfileSchema>;

/** Recruiter wizard — company first, then the person. */
export const CreateCompanySchema = z.object({
  name: z.string().trim().min(2, 'Enter your company name').max(160),
  industry: z.string().trim().min(2, 'Pick an industry').max(80),
  sizeBand: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']),
  website: z
    .string()
    .trim()
    .url('Enter a full URL, including https://')
    .nullable()
    .optional()
    .or(z.literal('')),
  headquarters: z.string().trim().min(2, 'Where is the company based?').max(120),
  description: z
    .string()
    .trim()
    .min(40, 'Give candidates at least a couple of sentences')
    .max(4000),
  logoUrl: z.string().url().nullable().optional(),
  /** Optional at creation — FR-302 only gates *publishing*, not sign-up.
   *  Blocking account creation on a CAC number would strand every recruiter
   *  whose paperwork is still in progress. */
  cacNumber: z
    .string()
    .trim()
    .regex(/^(RC|BN|IT)?[-\s]?\d{4,10}$/i, 'Enter a valid CAC number, e.g. RC1234567')
    .nullable()
    .optional()
    .or(z.literal('')),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;

export const CreateRecruiterProfileSchema = z.object({
  title: z.string().trim().min(2, 'What is your role there?').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[\d\s()-]{7,20}$/, 'Enter a valid phone number')
    .nullable()
    .optional()
    .or(z.literal('')),
  company: CreateCompanySchema,
});
export type CreateRecruiterProfileInput = z.infer<typeof CreateRecruiterProfileSchema>;

/**
 * The images on the profile header, editable from the profile screen itself.
 *
 * Separate from the profile wizards on purpose: changing your photo is a
 * one-tap action people expect to do from their own profile, not something
 * worth re-entering a four-step wizard for. `null` clears; omitted leaves alone,
 * which is why both are `.nullable().optional()` rather than just nullable.
 */
export const UpdateAccountImagesSchema = z.object({
  photoUrl: z.string().url().nullable().optional(),
  bannerUrl: z.string().url().nullable().optional(),
});
export type UpdateAccountImagesInput = z.infer<typeof UpdateAccountImagesSchema>;

/** FR-104 — picking a role after sign-up, or adding the second one later. */
export const SelectRoleSchema = z.object({
  role: z.enum(['intern', 'recruiter']),
});
export type SelectRoleInput = z.infer<typeof SelectRoleSchema>;

export const RoleOptionSchema = z.object({
  role: RoleSchema,
  hasProfile: z.boolean(),
});
export type RoleOption = z.infer<typeof RoleOptionSchema>;
