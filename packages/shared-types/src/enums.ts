import { z } from 'zod';

/** SRS §4.1 — an account may hold both role profiles; `admin` is provisioned, never self-registered. */
export const RoleSchema = z.enum(['intern', 'recruiter', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

/** The role a session is currently acting as. Carried as the `active_role` JWT claim (SRS §3.5). */
export const ActiveRoleSchema = z.enum(['intern', 'recruiter', 'admin']);
export type ActiveRole = z.infer<typeof ActiveRoleSchema>;

export const AccountStatusSchema = z.enum([
  'active',
  'restricted', // escalation ladder step 2 — FR-1107
  'suspended',
  'banned',
]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

/** SRS §6 — Listing.status */
export const ListingStatusSchema = z.enum(['draft', 'active', 'paused', 'closed']);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

/** SRS §6 / FR-402 — the pipeline both sides see. Order matters: it drives the stepper UI. */
export const ApplicationStatusSchema = z.enum([
  'applied',
  'reviewed',
  'interview',
  'offer',
  'rejected',
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export const APPLICATION_PIPELINE: readonly ApplicationStatus[] = [
  'applied',
  'reviewed',
  'interview',
  'offer',
] as const;

/** FR-302 — verification gates listing publication. */
export const VerificationStatusSchema = z.enum([
  'unsubmitted',
  'pending',
  'verified',
  'rejected',
  'expired',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/** FR-1106 — tiered badges. */
export const VerificationTierSchema = z.enum([
  'verified_company',
  'verified_school_email',
  'verified_identity',
]);
export type VerificationTier = z.infer<typeof VerificationTierSchema>;

export const WorkModeSchema = z.enum(['remote', 'onsite', 'hybrid']);
export type WorkMode = z.infer<typeof WorkModeSchema>;

export const AvailabilitySchema = z.enum([
  'immediately',
  'within_1_month',
  'within_3_months',
  'not_looking',
]);
export type Availability = z.infer<typeof AvailabilitySchema>;

/** FR-1105 — user controls who can see them. */
export const ProfileVisibilitySchema = z.enum(['public', 'connections_only', 'recruiters_only']);
export type ProfileVisibility = z.infer<typeof ProfileVisibilitySchema>;

export const ConnectionStatusSchema = z.enum(['pending', 'accepted', 'declined', 'blocked']);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/** FR-306 — company team permissions. */
export const CompanyMemberRoleSchema = z.enum(['owner', 'hiring_manager', 'viewer']);
export type CompanyMemberRole = z.infer<typeof CompanyMemberRoleSchema>;

export const AdPlacementSchema = z.enum(['banner', 'featured_listing', 'sponsored_push']);
export type AdPlacement = z.infer<typeof AdPlacementSchema>;
