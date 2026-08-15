import {
  RANKING_CONFIG,
  type Availability,
  type InternProfile,
  type Listing,
  type MatchBreakdown,
  type VerificationStatus,
  type WorkMode,
} from '@internlink/shared-types';

/**
 * FR-204 — profile-to-listing match scoring.
 *
 * Pure functions only: no Firestore, no clock beyond an injected `now`. That is
 * what makes the ranking testable, and it means a scoring change can be
 * evaluated offline against a fixture set before it goes anywhere near users.
 */

const { weights, freshnessHalfLifeDays, minSkillsToMatch } = RANKING_CONFIG.match;

/** Guards against a weight edit that silently rescales every score. */
export function assertWeightsSumToOne(): void {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`Match weights must sum to 1, got ${total}`);
  }
}

/** `Node.js`, `node js` and `NodeJS` are the same skill to a human. */
export function normaliseSkill(skill: string): string {
  return skill
    .toLowerCase()
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rarity weighting.
 *
 * A match on "Excel" says much less about fit than a match on "Kubernetes", so
 * scoring every overlap equally over-rewards generic profiles. With no corpus
 * statistics at launch this is a hand-built approximation of inverse document
 * frequency; it should be replaced by real counts once there is enough data to
 * compute them (a nightly job over `listings.skills` is enough).
 */
const COMMON_SKILLS = new Set(
  [
    'excel',
    'microsoft office',
    'word',
    'powerpoint',
    'communication',
    'teamwork',
    'customer service',
    'social media',
    'time management',
    'leadership',
    'problem solving',
  ].map(normaliseSkill),
);

const SPECIALIST_SKILLS = new Set(
  [
    'kubernetes',
    'terraform',
    'rust',
    'solidity',
    'machine learning',
    'tensorflow',
    'pytorch',
    'graphql',
    'kafka',
    'devops',
    'penetration testing',
    'data engineering',
  ].map(normaliseSkill),
);

export function skillRarityWeight(skill: string): number {
  const key = normaliseSkill(skill);
  if (COMMON_SKILLS.has(key)) return 0.55;
  if (SPECIALIST_SKILLS.has(key)) return 1.35;
  return 1;
}

export interface SkillMatch {
  score: number;
  matched: string[];
  missing: string[];
}

/**
 * Blends two different questions, because neither alone ranks well:
 *
 *   coverage — how much of what the role asks for does this person have?
 *              This is what a recruiter cares about.
 *   focus    — how central is this role to what the person says they do?
 *              Without it, someone listing 30 skills matches everything.
 *
 * Coverage dominates (0.78) because a candidate missing half the requirements
 * is a worse match than one whose skill list is merely broad.
 */
export function scoreSkills(profileSkills: string[], listingSkills: string[]): SkillMatch {
  if (listingSkills.length === 0) {
    // A listing with no stated skills cannot be matched on them. Return the
    // neutral midpoint rather than 0, or such listings would be buried.
    return { score: 0.5, matched: [], missing: [] };
  }

  const profileSet = new Set(profileSkills.map(normaliseSkill));
  const matched: string[] = [];
  const missing: string[] = [];

  let matchedWeight = 0;
  let totalWeight = 0;

  for (const skill of listingSkills) {
    const weight = skillRarityWeight(skill);
    totalWeight += weight;
    if (profileSet.has(normaliseSkill(skill))) {
      matched.push(skill);
      matchedWeight += weight;
    } else {
      missing.push(skill);
    }
  }

  const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;

  // Capped at 8: beyond that, "focus" stops being meaningful and starts
  // punishing people for having a full profile.
  const focusDenominator = Math.min(Math.max(profileSkills.length, 1), 8);
  const focus = Math.min(1, matched.length / focusDenominator);

  return {
    score: clamp01(0.78 * coverage + 0.22 * focus),
    matched,
    missing,
  };
}

/**
 * Remote roles score full marks regardless of where the candidate is — that is
 * the entire point of a remote role, and penalising distance would be wrong.
 */
export function scoreLocation(
  profileLocation: string | null,
  listingLocation: string | null,
  workMode: WorkMode,
): { score: number; reason: string } {
  if (workMode === 'remote') return { score: 1, reason: 'Remote — location is not a barrier' };
  if (!profileLocation || !listingLocation) return { score: 0.5, reason: '' };

  const profileParts = splitLocation(profileLocation);
  const listingParts = splitLocation(listingLocation);

  if (profileParts.city && profileParts.city === listingParts.city) {
    return { score: 1, reason: `Both in ${titleCase(profileParts.city)}` };
  }
  if (profileParts.region && profileParts.region === listingParts.region) {
    return { score: 0.62, reason: `Same region — ${titleCase(profileParts.region)}` };
  }
  return { score: 0.22, reason: '' };
}

function splitLocation(value: string): { city: string; region: string } {
  const parts = value
    .toLowerCase()
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return { city: parts[0] ?? '', region: parts[parts.length - 1] ?? '' };
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Hybrid is treated as partially satisfying both remote and on-site
 * preferences, because in practice it does.
 */
export function scoreWorkMode(preferred: WorkMode[], listingMode: WorkMode): number {
  if (preferred.length === 0) return 0.5;
  if (preferred.includes(listingMode)) return 1;
  if (listingMode === 'hybrid' && (preferred.includes('remote') || preferred.includes('onsite'))) {
    return 0.7;
  }
  if (preferred.includes('hybrid') && (listingMode === 'remote' || listingMode === 'onsite')) {
    return 0.6;
  }
  return 0.2;
}

const AVAILABILITY_SCORE: Record<Availability, number> = {
  immediately: 1,
  within_1_month: 0.85,
  within_3_months: 0.55,
  // Not zero: someone browsing passively should still see good roles, they
  // just should not outrank an actively-looking candidate's feed.
  not_looking: 0.2,
};

export function scoreAvailability(availability: Availability): number {
  return AVAILABILITY_SCORE[availability];
}

/**
 * Exponential decay on age. A listing at exactly one half-life scores 0.5.
 *
 * Exponential rather than linear because the difference between a 1-day-old
 * and a 3-day-old listing genuinely matters, while the difference between 40
 * and 42 days does not.
 */
export function scoreFreshness(publishedAt: string | null, now: number): number {
  if (!publishedAt) return 0.3;
  const ageMs = now - new Date(publishedAt).getTime();
  if (Number.isNaN(ageMs)) return 0.3;
  const ageDays = Math.max(0, ageMs / 86_400_000);
  return clamp01(Math.pow(0.5, ageDays / freshnessHalfLifeDays));
}

const TRUST_SCORE: Record<VerificationStatus, number> = {
  verified: 1,
  pending: 0.55,
  unsubmitted: 0.35,
  rejected: 0.1,
  expired: 0.25,
};

export function scoreTrust(status: VerificationStatus): number {
  return TRUST_SCORE[status];
}

/* ============================================================ composition = */

export interface ScoreListingArgs {
  profile: InternProfile;
  listing: Listing;
  companyVerification: VerificationStatus;
  hasApplied: boolean;
  now: number;
}

export interface ScoredListing {
  score: number;
  breakdown: MatchBreakdown[];
  matchedSkills: string[];
  missingSkills: string[];
  highlights: string[];
}

export function scoreListing(args: ScoreListingArgs): ScoredListing {
  const { profile, listing, companyVerification, now } = args;

  const skills = scoreSkills(profile.skills, listing.skills);
  const location = scoreLocation(profile.location, listing.location, listing.workMode);
  const workMode = scoreWorkMode(profile.preferredWorkModes, listing.workMode);
  const availability = scoreAvailability(profile.availability);
  const freshness = scoreFreshness(listing.publishedAt, now);
  const trust = scoreTrust(companyVerification);

  const breakdown: MatchBreakdown[] = [
    {
      signal: 'skills',
      score: skills.score,
      weight: weights.skills,
      reason: skills.matched.length
        ? `You have ${skills.matched.length} of the ${listing.skills.length} skills they asked for`
        : 'None of the listed skills are on your profile yet',
    },
    { signal: 'location', score: location.score, weight: weights.location, reason: location.reason },
    {
      signal: 'workMode',
      score: workMode,
      weight: weights.workMode,
      reason: workMode >= 1 ? `${titleCase(listing.workMode)} — how you prefer to work` : '',
    },
    {
      signal: 'availability',
      score: availability,
      weight: weights.availability,
      reason: profile.availability === 'immediately' ? 'You can start right away' : '',
    },
    {
      signal: 'freshness',
      score: freshness,
      weight: weights.freshness,
      reason: freshness > 0.8 ? 'Posted recently' : '',
    },
    {
      signal: 'trust',
      score: trust,
      weight: weights.trust,
      reason: companyVerification === 'verified' ? 'Verified company' : '',
    },
  ];

  const raw = breakdown.reduce((sum, part) => sum + part.score * part.weight, 0);

  return {
    score: Math.round(clamp01(raw) * 100),
    breakdown,
    matchedSkills: skills.matched,
    missingSkills: skills.missing,
    // Strongest signals first, so the card leads with the best reason rather
    // than whichever happens to be first in the array.
    highlights: breakdown
      .filter((b) => b.reason && b.score >= 0.6)
      .sort((a, b) => b.score * b.weight - a.score * a.weight)
      .slice(0, 3)
      .map((b) => b.reason),
  };
}

/** A profile below the skill floor produces noise, not matches. */
export function canMatch(profile: InternProfile): boolean {
  return profile.skills.length >= minSkillsToMatch;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
