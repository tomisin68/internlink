import type { Account, Company } from '@internlink/shared-types';

/**
 * One place that decides what "verified" means on screen.
 *
 * The API canonicalises verification state before it ships (see the API's
 * `lib/verification.ts` — verification is granted by hand in the Firestore
 * console, so the stored value is whatever a moderator typed). These helpers
 * exist so the badge, the label under it, and the publish gate can never drift
 * apart, and so a payload that somehow arrives un-canonicalised still renders
 * the badge a moderator intended rather than silently withholding it.
 */

/** Tolerates a hand-added boolean whatever type the console stored it as. */
function flag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', 'yes', '1'].includes(value.trim().toLowerCase());
  return false;
}

export function isCompanyVerified(
  company: Pick<Company, 'verificationStatus'> | null | undefined,
): boolean {
  if (!company) return false;
  const record = company as Record<string, unknown>;
  if (flag(record.isVerified) || flag(record.verified)) return true;

  const status = record.verificationStatus;
  return typeof status === 'string' && status.trim().toLowerCase() === 'verified';
}

export function isAccountVerified(
  account: Pick<Account, 'verificationTiers'> | null | undefined,
): boolean {
  if (!account) return false;
  const record = account as Record<string, unknown>;
  if (flag(record.isVerified) || flag(record.verified)) return true;

  const tiers = record.verificationTiers;
  if (Array.isArray(tiers)) return tiers.length > 0;
  // A tier list typed straight into the console arrives as a string.
  return typeof tiers === 'string' && tiers.trim().length > 0;
}
