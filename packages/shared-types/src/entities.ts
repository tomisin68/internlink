import { z } from 'zod';
import {
  AccountStatusSchema,
  ActiveRoleSchema,
  ApplicationStatusSchema,
  AvailabilitySchema,
  CompanyMemberRoleSchema,
  ConnectionStatusSchema,
  ListingStatusSchema,
  ProfileVisibilitySchema,
  RoleSchema,
  VerificationStatusSchema,
  VerificationTierSchema,
  WorkModeSchema,
} from './enums.js';

/** Firestore timestamps cross the wire as ISO-8601 strings. */
export const IsoDateSchema = z.string().datetime({ offset: true });

export const IdSchema = z.string().min(1).max(128);

/* ============================================================ Account ===== */

/**
 * SRS §6 — one record per login identity.
 *
 * Note there is no `password_hash` here, unlike the SRS table: Firebase
 * Authentication owns credentials, so the API never sees or stores a hash.
 * That satisfies §5.2's hashing requirement by delegation.
 */
export const AccountSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  /** Denormalised for list rendering — always `firstName + ' ' + lastName`. */
  displayName: z.string().min(1).max(140),
  photoUrl: z.string().url().nullable(),
  /**
   * Profile cover image. Lives on the account rather than the intern profile so
   * a recruiter has one too — the profile header is the same component for both
   * roles, and putting it on one profile type would leave the other with a hole.
   */
  bannerUrl: z.string().url().nullable().default(null),
  /**
   * Which profiles this account actually holds. Drives the role switcher.
   *
   * Empty is a legitimate state, not an error: it is exactly what a
   * just-created account looks like between sign-up and the role screen, and
   * it is what `computeNextStep` reads to send someone to `select_role`. A
   * `.min(1)` here would make the schema reject the account it just created.
   */
  roles: z.array(RoleSchema),
  activeRole: ActiveRoleSchema,
  status: AccountStatusSchema,
  emailVerified: z.boolean(),
  /** FR-1104 — required before a recruiter account can post. */
  twoFactorEnabled: z.boolean(),
  verificationTiers: z.array(VerificationTierSchema),
  /** FR-1103 — new accounts are throttled for their first 24–48h. */
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  lastActiveAt: IsoDateSchema.nullable(),
  onboardingCompletedAt: IsoDateSchema.nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

/* ====================================================== Intern profile ==== */

export const EducationEntrySchema = z.object({
  id: IdSchema,
  school: z.string().min(1).max(160),
  degree: z.string().max(120).nullable(),
  fieldOfStudy: z.string().max(120).nullable(),
  startYear: z.number().int().min(1950).max(2100),
  endYear: z.number().int().min(1950).max(2100).nullable(),
  grade: z.string().max(40).nullable(),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

export const ExperienceEntrySchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(140),
  company: z.string().min(1).max(160),
  workMode: WorkModeSchema.nullable(),
  location: z.string().max(120).nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM'),
  endDate: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM').nullable(),
  isCurrent: z.boolean(),
  description: z.string().max(2000).nullable(),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

export const CertificationSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160),
  issuer: z.string().min(1).max(160),
  issuedAt: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  credentialUrl: z.string().url().nullable(),
});
export type Certification = z.infer<typeof CertificationSchema>;

export const PortfolioLinkSchema = z.object({
  label: z.string().min(1).max(60),
  url: z.string().url(),
});
export type PortfolioLink = z.infer<typeof PortfolioLinkSchema>;

/** SRS §6 + FR-1001 — LinkedIn-style layout needs more than the base table. */
export const InternProfileSchema = z.object({
  accountId: IdSchema,
  headline: z.string().max(140).nullable(),
  about: z.string().max(2600).nullable(),
  school: z.string().max(160).nullable(),
  location: z.string().max(120).nullable(),
  skills: z.array(z.string().min(1).max(48)).max(30),
  availability: AvailabilitySchema,
  preferredWorkModes: z.array(WorkModeSchema),
  cvUrl: z.string().url().nullable(),
  cvFileName: z.string().max(200).nullable(),
  portfolioLinks: z.array(PortfolioLinkSchema).max(6),
  education: z.array(EducationEntrySchema).max(12),
  experience: z.array(ExperienceEntrySchema).max(20),
  certifications: z.array(CertificationSchema).max(20),
  /** FR-1004 — visible to recruiters only, never broadcast. */
  openToOpportunities: z.boolean(),
  visibility: ProfileVisibilitySchema,
  /** FR-202 — 0-100, computed server-side so every client agrees on the number. */
  completeness: z.number().int().min(0).max(100),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type InternProfile = z.infer<typeof InternProfileSchema>;

/* =================================================== Company & recruiter == */

export const CompanySchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160),
  /** FR-302 — CAC is the Nigerian trust signal per §2.5. */
  cacNumber: z.string().max(40).nullable(),
  verificationStatus: VerificationStatusSchema,
  verificationDocUrl: z.string().url().nullable(),
  verifiedAt: IsoDateSchema.nullable(),
  logoUrl: z.string().url().nullable(),
  website: z.string().url().nullable(),
  industry: z.string().max(80).nullable(),
  sizeBand: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).nullable(),
  headquarters: z.string().max(120).nullable(),
  description: z.string().max(4000).nullable(),
  ownerAccountId: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Company = z.infer<typeof CompanySchema>;

export const RecruiterProfileSchema = z.object({
  accountId: IdSchema,
  companyId: IdSchema.nullable(),
  title: z.string().max(120).nullable(),
  /** FR-306 — permission within the company account. */
  companyRole: CompanyMemberRoleSchema,
  phone: z.string().max(32).nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type RecruiterProfile = z.infer<typeof RecruiterProfileSchema>;

/* ====================================================== Listing / apply === */

export const SalaryRangeSchema = z.object({
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  currency: z.string().length(3).default('NGN'),
  period: z.enum(['month', 'year', 'stipend']),
});

export const ListingSchema = z.object({
  id: IdSchema,
  companyId: IdSchema,
  title: z.string().min(1).max(160),
  description: z.string().max(12000),
  skills: z.array(z.string().min(1).max(48)).max(20),
  location: z.string().max(120).nullable(),
  workMode: WorkModeSchema,
  durationMonths: z.number().int().min(1).max(36).nullable(),
  salary: SalaryRangeSchema.nullable(),
  status: ListingStatusSchema,
  applicationCount: z.number().int().nonnegative(),
  publishedAt: IsoDateSchema.nullable(),
  closesAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Listing = z.infer<typeof ListingSchema>;

export const ApplicationSchema = z.object({
  id: IdSchema,
  listingId: IdSchema,
  internAccountId: IdSchema,
  companyId: IdSchema,
  status: ApplicationStatusSchema,
  coverNote: z.string().max(2000).nullable(),
  cvUrl: z.string().url().nullable(),
  /** FR-404 — recruiter-only, must never be serialised to the intern. */
  internalNotes: z.array(
    z.object({
      id: IdSchema,
      authorAccountId: IdSchema,
      body: z.string().max(2000),
      createdAt: IsoDateSchema,
    }),
  ),
  statusHistory: z.array(
    z.object({
      status: ApplicationStatusSchema,
      changedBy: IdSchema,
      changedAt: IsoDateSchema,
    }),
  ),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Application = z.infer<typeof ApplicationSchema>;

/** What an intern is allowed to see — internalNotes stripped (FR-404). */
export const ApplicationPublicSchema = ApplicationSchema.omit({ internalNotes: true });
export type ApplicationPublic = z.infer<typeof ApplicationPublicSchema>;

/* ========================================================== Network ======= */

export const ConnectionSchema = z.object({
  id: IdSchema,
  requesterId: IdSchema,
  recipientId: IdSchema,
  status: ConnectionStatusSchema,
  createdAt: IsoDateSchema,
  respondedAt: IsoDateSchema.nullable(),
});
export type Connection = z.infer<typeof ConnectionSchema>;
