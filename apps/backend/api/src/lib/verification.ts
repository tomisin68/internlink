import type { VerificationStatus, VerificationTier } from '@internlink/shared-types';

/**
 * Makes hand-edited verification state readable.
 *
 * There is no admin UI for verification (FR-902 is still a console job), so the
 * only way anyone gets verified today is a moderator opening the Firestore
 * console and editing the document. That console is a plain key/value editor:
 * it does not know the field is an enum, does not offer the allowed values, and
 * happily saves `Verified`, `approved`, a stray trailing space, or a boolean
 * `isVerified` field the moderator invented because it read more naturally than
 * a status string.
 *
 * Every one of those is an unambiguous "this company is approved", and every
 * one of them used to render as *unverified*, because the whole app compares
 * `verificationStatus === 'verified'` exactly. The moderator sees the edit
 * saved in the console and the badge still missing, with nothing anywhere to
 * explain the gap.
 *
 * So the comparison stays strict and the *data* is normalised on the way in.
 * This runs at the single read boundary (`serialise`), which means it covers
 * every path — session, company page, browse, search, feed, post authors — with
 * one implementation rather than fourteen call sites that each have to
 * remember.
 *
 * Nothing here writes back. The document keeps whatever the moderator typed;
 * only the value the API serves is canonicalised.
 */

/* ================================================================ flags ==== */

/**
 * The boolean field names a moderator plausibly reaches for. Deliberately
 * short: every name added here is a name that has to keep working forever,
 * and a typo'd field silently doing nothing is better than a near-miss field
 * silently verifying the wrong account.
 */
const FLAG_KEYS = ['isVerified', 'is_verified', 'verified'] as const;

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'on', 'verified', 'approved']);
const FALSE_Y = new Set(['false', 'no', 'n', '0', 'off', 'unverified']);

/**
 * Reads a hand-typed boolean. The console stores whatever type was picked from
 * its dropdown, and "string" is the default — so `true` and `"true"` both have
 * to mean the same thing.
 */
function readFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase();
    if (TRUTHY.has(token)) return true;
    if (FALSE_Y.has(token)) return false;
  }
  return null;
}

/** The first flag field actually present, or null when the moderator set none. */
function readVerifiedFlag(record: Record<string, unknown>): boolean | null {
  for (const key of FLAG_KEYS) {
    if (!(key in record)) continue;
    const flag = readFlag(record[key]);
    if (flag !== null) return flag;
  }
  return null;
}

/* =============================================================== company === */

/** Every spelling of a status that has one obvious intended meaning. */
const STATUS_ALIASES: Record<string, VerificationStatus> = {
  verified: 'verified',
  verify: 'verified',
  approved: 'verified',
  approve: 'verified',
  accepted: 'verified',
  active: 'verified',
  complete: 'verified',
  completed: 'verified',
  done: 'verified',
  true: 'verified',
  yes: 'verified',
  '1': 'verified',

  pending: 'pending',
  submitted: 'pending',
  submit: 'pending',
  review: 'pending',
  reviewing: 'pending',
  in_review: 'pending',
  'in review': 'pending',
  processing: 'pending',
  awaiting: 'pending',

  rejected: 'rejected',
  reject: 'rejected',
  declined: 'rejected',
  denied: 'rejected',
  refused: 'rejected',
  failed: 'rejected',

  expired: 'expired',
  lapsed: 'expired',

  unsubmitted: 'unsubmitted',
  unverified: 'unsubmitted',
  none: 'unsubmitted',
  no: 'unsubmitted',
  false: 'unsubmitted',
  '0': 'unsubmitted',
  '': 'unsubmitted',
};

/** A moderator's decision is final — these are never upgraded by inference. */
const TERMINAL: ReadonlySet<VerificationStatus> = new Set<VerificationStatus>([
  'rejected',
  'expired',
]);

export function resolveCompanyStatus(record: Record<string, unknown>): VerificationStatus {
  const raw = record.verificationStatus;
  const token = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';

  // An unrecognised string is left at `pending` rather than `unsubmitted`: it
  // means *something* was typed, and a company whose moderator typed something
  // is not a company that never applied.
  const stated: VerificationStatus =
    STATUS_ALIASES[token] ?? (token ? 'pending' : 'unsubmitted');

  const flag = readVerifiedFlag(record);
  if (flag === true) return 'verified';
  // An explicit `false` is a revocation, so it has to be able to undo a
  // `verified` status — otherwise the field is a one-way switch and the only
  // way back is deleting it.
  if (flag === false) return stated === 'verified' ? 'unsubmitted' : stated;

  // `verifiedAt` is only ever written when verification is granted, so a
  // moderator who filled in the date and forgot the status still meant yes.
  if (stated !== 'verified' && !TERMINAL.has(stated) && isPresent(record.verifiedAt)) {
    return 'verified';
  }

  return stated;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/* =============================================================== account === */

const TIER_ALIASES: Record<string, VerificationTier> = {
  verified_company: 'verified_company',
  company: 'verified_company',
  employer: 'verified_company',

  verified_school_email: 'verified_school_email',
  school_email: 'verified_school_email',
  school: 'verified_school_email',
  student: 'verified_school_email',
  university: 'verified_school_email',

  verified_identity: 'verified_identity',
  identity: 'verified_identity',
  id: 'verified_identity',
  kyc: 'verified_identity',
};

/**
 * The tier granted when a moderator flips a boolean instead of naming a tier.
 *
 * Identity is the honest default: a moderator ticking "verified" on a person
 * has satisfied themselves that the person is who they claim, which is exactly
 * what this tier asserts. Guessing `verified_school_email` would state a fact
 * about their email that nobody checked.
 */
const DEFAULT_TIER: VerificationTier = 'verified_identity';

export function resolveAccountTiers(record: Record<string, unknown>): VerificationTier[] {
  const raw = record.verificationTiers;

  // Arrays are painful to build in the Firestore console, so a comma-separated
  // string is accepted as the same thing.
  const tokens: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];

  const tiers: VerificationTier[] = [];
  for (const token of tokens) {
    if (typeof token !== 'string') continue;
    const tier = TIER_ALIASES[token.trim().toLowerCase().replace(/[\s-]+/g, '_')];
    if (tier && !tiers.includes(tier)) tiers.push(tier);
  }

  const flag = readVerifiedFlag(record);
  if (flag === true && tiers.length === 0) return [DEFAULT_TIER];
  if (flag === false) return [];

  return tiers;
}

/* ============================================================ normalise ==== */

/** Companies own `ownerAccountId`; nothing else in the schema does. */
function isCompanyShaped(record: Record<string, unknown>): boolean {
  return 'verificationStatus' in record || ('ownerAccountId' in record && 'name' in record);
}

function isAccountShaped(record: Record<string, unknown>): boolean {
  return 'verificationTiers' in record || ('roles' in record && 'activeRole' in record);
}

/**
 * Canonicalises the verification fields of an already-serialised document.
 *
 * Shape-sniffed rather than told what it is, because the call site is
 * `serialise`, which is generic by design and handles every collection. The two
 * tests below are narrow enough that no other document type matches: a post's
 * denormalised `author` block carries `isVerified` but neither
 * `verificationStatus` nor `verificationTiers`, so it is left alone and keeps
 * the value the hydrator computed.
 *
 * Idempotent — running it on already-canonical data changes nothing.
 */
export function normaliseVerification(record: Record<string, unknown>): void {
  if (isCompanyShaped(record)) {
    record.verificationStatus = resolveCompanyStatus(record);
  }
  if (isAccountShaped(record)) {
    record.verificationTiers = resolveAccountTiers(record);
  }
}
