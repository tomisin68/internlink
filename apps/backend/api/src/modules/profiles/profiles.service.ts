import type {
  Account,
  CreateInternProfileInput,
  InternProfile,
  UpdateInternProfileInput,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { nowIso, serialise } from '../../lib/firestore.js';
import { notFound } from '../../lib/errors.js';
import { buildSession, getAccount } from '../auth/auth.service.js';
import type { SessionPayload } from '@internlink/shared-types';

/**
 * FR-202 — profile completeness, scored server-side.
 *
 * Weights are chosen by what actually improves match quality (FR-204), not by
 * counting fields evenly. Skills and education move the ranking; a portfolio
 * link is nice but does not. The user sees this number on a progress ring, so
 * it needs to move satisfyingly as they fill things in — hence a handful of
 * mid-weight items rather than two big ones.
 */
const COMPLETENESS_WEIGHTS: ReadonlyArray<{
  key: string;
  weight: number;
  test: (p: InternProfile, a: Account) => boolean;
}> = [
  { key: 'name', weight: 5, test: (_p, a) => Boolean(a.firstName && a.lastName) },
  { key: 'photo', weight: 10, test: (_p, a) => Boolean(a.photoUrl) },
  { key: 'headline', weight: 12, test: (p) => Boolean(p.headline && p.headline.length >= 10) },
  { key: 'about', weight: 10, test: (p) => Boolean(p.about && p.about.length >= 80) },
  { key: 'location', weight: 5, test: (p) => Boolean(p.location) },
  { key: 'skills', weight: 18, test: (p) => p.skills.length >= 3 },
  { key: 'education', weight: 15, test: (p) => p.education.length > 0 || Boolean(p.school) },
  { key: 'experience', weight: 10, test: (p) => p.experience.length > 0 },
  { key: 'cv', weight: 10, test: (p) => Boolean(p.cvUrl) },
  { key: 'portfolio', weight: 5, test: (p) => p.portfolioLinks.length > 0 },
];

export function computeCompleteness(profile: InternProfile, account: Account): number {
  const earned = COMPLETENESS_WEIGHTS.reduce(
    (sum, rule) => sum + (rule.test(profile, account) ? rule.weight : 0),
    0,
  );
  const total = COMPLETENESS_WEIGHTS.reduce((sum, r) => sum + r.weight, 0);
  return Math.round((earned / total) * 100);
}

/** What is still missing, in weight order — drives the "complete your profile" nudges. */
export function missingCompletenessItems(profile: InternProfile, account: Account): string[] {
  return COMPLETENESS_WEIGHTS.filter((r) => !r.test(profile, account))
    .sort((a, b) => b.weight - a.weight)
    .map((r) => r.key);
}

/** Firestore has no auto-ID for array members, so entries get one on write. */
function withIds<T extends object>(items: T[], prefix: string): Array<T & { id: string }> {
  return items.map((item, index) => ({ ...item, id: `${prefix}_${index}_${Date.now().toString(36)}` }));
}

function emptyProfile(accountId: string): InternProfile {
  const ts = nowIso();
  return {
    accountId,
    headline: null,
    about: null,
    school: null,
    location: null,
    skills: [],
    availability: 'immediately',
    preferredWorkModes: [],
    cvUrl: null,
    cvFileName: null,
    portfolioLinks: [],
    education: [],
    experience: [],
    certifications: [],
    openToOpportunities: true,
    visibility: 'public',
    completeness: 0,
    createdAt: ts,
    updatedAt: ts,
  };
}

export async function getInternProfile(accountId: string): Promise<InternProfile | null> {
  const snap = await db().collection(Collections.internProfiles).doc(accountId).get();
  if (!snap.exists) return null;
  return serialise<InternProfile>({ accountId, ...snap.data() });
}

/**
 * Creates or replaces the intern profile. The wizard POSTs once at the end, so
 * this is a whole-document write rather than a merge — a partially-filled
 * second run should not leave orphaned values from the first.
 */
export async function upsertInternProfile(
  accountId: string,
  input: CreateInternProfileInput,
): Promise<SessionPayload> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('Your account');

  const existing = await getInternProfile(accountId);
  const base = existing ?? emptyProfile(accountId);

  const profile: InternProfile = {
    ...base,
    headline: input.headline ?? base.headline,
    about: input.about ?? base.about,
    school: input.school ?? base.school,
    location: input.location ?? base.location,
    skills: input.skills ?? base.skills,
    availability: input.availability ?? base.availability,
    preferredWorkModes: input.preferredWorkModes ?? base.preferredWorkModes,
    cvUrl: input.cvUrl ?? base.cvUrl,
    cvFileName: input.cvFileName ?? base.cvFileName,
    portfolioLinks: input.portfolioLinks ?? base.portfolioLinks,
    education: input.education ? withIds(input.education, 'edu') : base.education,
    experience: input.experience ? withIds(input.experience, 'exp') : base.experience,
    certifications: input.certifications ? withIds(input.certifications, 'cert') : base.certifications,
    openToOpportunities: input.openToOpportunities ?? base.openToOpportunities,
    visibility: input.visibility ?? base.visibility,
    updatedAt: nowIso(),
  };

  profile.completeness = computeCompleteness(profile, account);

  const { accountId: _omit, ...doc } = profile;
  void _omit;
  await db().collection(Collections.internProfiles).doc(accountId).set(doc);

  return buildSession(account);
}

export async function patchInternProfile(
  accountId: string,
  input: UpdateInternProfileInput,
): Promise<InternProfile> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('Your account');

  const existing = await getInternProfile(accountId);
  if (!existing) throw notFound('Your profile');

  const merged: InternProfile = {
    ...existing,
    ...(input as Partial<InternProfile>),
    ...(input.education ? { education: withIds(input.education, 'edu') } : {}),
    ...(input.experience ? { experience: withIds(input.experience, 'exp') } : {}),
    ...(input.certifications ? { certifications: withIds(input.certifications, 'cert') } : {}),
    accountId,
    updatedAt: nowIso(),
  };
  merged.completeness = computeCompleteness(merged, account);

  const { accountId: _omit, ...doc } = merged;
  void _omit;
  await db().collection(Collections.internProfiles).doc(accountId).set(doc, { merge: true });

  return merged;
}
