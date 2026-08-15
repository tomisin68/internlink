import type {
  Account,
  InternProfile,
  PeopleQuery,
  PersonSummary,
  PublicProfile,
  RecruiterProfile,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { serialise } from '../../lib/firestore.js';
import { notFound } from '../../lib/errors.js';
import { getAccount } from '../auth/auth.service.js';
import { getCompany } from '../companies/companies.service.js';
import {
  buildRelationshipResolver,
  connectedIds,
  followCounts,
  followedIds,
  type RelationshipResolver,
} from './connections.service.js';

/**
 * FR-1006 — finding people to connect with.
 *
 * The directory is assembled by reading a bounded pool of accounts and ranking
 * them in memory, the same fan-out-on-read trade the feed makes. Firestore has
 * no substring search, so a server-side `q` filter would only ever be a prefix
 * match on one field — worse than filtering a pool the API has already paid to
 * read.
 *
 * The ceiling is visible: once the pool no longer contains the person someone
 * is looking for, the answer is a search index (Algolia/Typesense fed by a
 * Firestore trigger), not a bigger pool.
 */
const DIRECTORY_POOL = 250;

/** Denormalised bits of a person that live outside the account document. */
interface PersonContext {
  headline: string | null;
  location: string | null;
  companyName: string | null;
}

/**
 * Loads headline/company for a batch of accounts.
 *
 * Two batched queries rather than two per person: `internProfiles` and
 * `recruiterProfiles` are both keyed by account ID, so a `__name__ in` chunk
 * fetches thirty at a time.
 */
async function loadContexts(accountIds: string[]): Promise<Map<string, PersonContext>> {
  const contexts = new Map<string, PersonContext>();
  if (accountIds.length === 0) return contexts;

  const chunks: string[][] = [];
  for (let i = 0; i < accountIds.length; i += 30) chunks.push(accountIds.slice(i, i + 30));

  const [internSnaps, recruiterSnaps] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        db().collection(Collections.internProfiles).where('__name__', 'in', chunk).get(),
      ),
    ),
    Promise.all(
      chunks.map((chunk) =>
        db().collection(Collections.recruiterProfiles).where('__name__', 'in', chunk).get(),
      ),
    ),
  ]);

  for (const snap of internSnaps) {
    for (const doc of snap.docs) {
      const profile = doc.data() as Partial<InternProfile>;
      contexts.set(doc.id, {
        headline: profile.headline ?? null,
        location: profile.location ?? null,
        companyName: null,
      });
    }
  }

  // Recruiters need their company name, which is a second hop. Deduplicated so
  // twenty recruiters at one company cost one company read, not twenty.
  const companyIdByAccount = new Map<string, string>();
  for (const snap of recruiterSnaps) {
    for (const doc of snap.docs) {
      const profile = doc.data() as Partial<RecruiterProfile>;
      if (profile.companyId) companyIdByAccount.set(doc.id, profile.companyId);
      const existing = contexts.get(doc.id);
      contexts.set(doc.id, {
        headline: existing?.headline ?? profile.title ?? null,
        location: existing?.location ?? null,
        companyName: null,
      });
    }
  }

  const companyIds = [...new Set(companyIdByAccount.values())];
  if (companyIds.length > 0) {
    const companyChunks: string[][] = [];
    for (let i = 0; i < companyIds.length; i += 30) companyChunks.push(companyIds.slice(i, i + 30));

    const names = new Map<string, string>();
    const snaps = await Promise.all(
      companyChunks.map((chunk) =>
        db().collection(Collections.companies).where('__name__', 'in', chunk).get(),
      ),
    );
    for (const snap of snaps) {
      for (const doc of snap.docs) names.set(doc.id, (doc.data().name as string) ?? '');
    }

    for (const [accountId, companyId] of companyIdByAccount) {
      const existing = contexts.get(accountId);
      contexts.set(accountId, {
        headline: existing?.headline ?? null,
        location: existing?.location ?? null,
        companyName: names.get(companyId) ?? null,
      });
    }
  }

  return contexts;
}

function toPersonSummary(
  account: Account,
  context: PersonContext | undefined,
  resolver: RelationshipResolver,
  followingAccounts: Set<string>,
): PersonSummary {
  return {
    id: account.id,
    displayName: account.displayName || `${account.firstName} ${account.lastName}`.trim(),
    photoUrl: account.photoUrl ?? null,
    headline: context?.headline ?? null,
    activeRole: account.activeRole,
    isVerified: (account.verificationTiers ?? []).length > 0,
    companyName: context?.companyName ?? null,
    location: context?.location ?? null,
    relationship: resolver.relationshipTo(account.id),
    isFollowing: followingAccounts.has(account.id),
    connectionId: resolver.connectionIdFor(account.id),
    mutualConnections: resolver.mutualCount(account.id),
  };
}

/** Turns a set of account IDs into viewer-aware summaries. */
export async function summariseAccounts(
  viewerId: string,
  accountIds: string[],
): Promise<PersonSummary[]> {
  if (accountIds.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < accountIds.length; i += 30) chunks.push(accountIds.slice(i, i + 30));

  const [snaps, resolver, follows, contexts] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        db().collection(Collections.accounts).where('__name__', 'in', chunk).get(),
      ),
    ),
    buildRelationshipResolver(viewerId),
    followedIds(viewerId),
    loadContexts(accountIds),
  ]);

  const accounts = snaps.flatMap((snap) =>
    snap.docs.map((doc) => serialise<Account>({ id: doc.id, ...doc.data() })),
  );

  // Preserve the caller's ordering — it is usually meaningful (most recent
  // request first, highest-ranked suggestion first).
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return accountIds
    .map((id) => byId.get(id))
    .filter((a): a is Account => Boolean(a))
    .map((account) => toPersonSummary(account, contexts.get(account.id), resolver, follows.accounts));
}

/**
 * FR-1006 — the "people you may know" directory.
 *
 * Ranked by mutual connections first, because that is the signal that makes a
 * suggestion worth acting on, then by how complete a profile is — an empty
 * profile is nearly always a half-finished signup, and suggesting it wastes the
 * one impression you get.
 */
export async function listPeople(
  viewerId: string,
  query: PeopleQuery,
): Promise<PersonSummary[]> {
  const [snap, resolver, follows] = await Promise.all([
    db()
      .collection(Collections.accounts)
      .orderBy('createdAt', 'desc')
      .limit(DIRECTORY_POOL)
      .get(),
    buildRelationshipResolver(viewerId),
    followedIds(viewerId),
  ]);

  const pool = snap.docs
    .map((doc) => serialise<Account>({ id: doc.id, ...doc.data() }))
    .filter(
      (account) =>
        account.id !== viewerId &&
        account.status === 'active' &&
        !resolver.blockedIds.has(account.id),
    );

  const contexts = await loadContexts(pool.map((a) => a.id));

  let people = pool.map((account) =>
    toPersonSummary(account, contexts.get(account.id), resolver, follows.accounts),
  );

  const term = query.q?.trim().toLowerCase();
  if (term) {
    people = people.filter((person) =>
      [person.displayName, person.headline, person.companyName]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term)),
    );
  }

  if (query.scope === 'suggested') {
    // Already-connected people are not suggestions. Outstanding requests stay
    // in the list: seeing "Pending" is what stops someone asking twice.
    people = people.filter((person) => person.relationship !== 'connected');
  }

  people.sort((a, b) => {
    if (b.mutualConnections !== a.mutualConnections) {
      return b.mutualConnections - a.mutualConnections;
    }
    const score = (p: PersonSummary) =>
      (p.headline ? 2 : 0) + (p.photoUrl ? 1 : 0) + (p.isVerified ? 1 : 0);
    return score(b) - score(a);
  });

  return people.slice(0, query.limit);
}

/**
 * FR-1105 — whether this viewer may read the profile body.
 *
 * The header is always visible; only the detail is gated. A profile that 404s
 * because it is connections-only is indistinguishable from one that does not
 * exist, which would make it impossible to connect with someone you just met.
 */
function visibilityFor(
  visibility: InternProfile['visibility'],
  viewerIsSelf: boolean,
  viewerIsConnection: boolean,
  viewerIsRecruiter: boolean,
): 'connections_only' | 'recruiters_only' | null {
  if (viewerIsSelf || visibility === 'public') return null;
  if (visibility === 'connections_only') return viewerIsConnection ? null : 'connections_only';
  if (visibility === 'recruiters_only') return viewerIsRecruiter ? null : 'recruiters_only';
  return null;
}

/** GET /v1/profiles/:accountId — someone else's profile, as this viewer sees it. */
export async function getPublicProfile(
  viewerId: string,
  viewerRole: string,
  accountId: string,
): Promise<PublicProfile> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('That person');

  const [summaries, profileSnap, recruiterSnap, counts, connections, postCount] = await Promise.all(
    [
      summariseAccounts(viewerId, [accountId]),
      db().collection(Collections.internProfiles).doc(accountId).get(),
      db().collection(Collections.recruiterProfiles).doc(accountId).get(),
      followCounts(accountId),
      connectedIds(accountId),
      db()
        .collection(Collections.posts)
        .where('authorAccountId', '==', accountId)
        .count()
        .get(),
    ],
  );

  const person = summaries[0];
  if (!person) throw notFound('That person');
  if (person.relationship === 'blocked') throw notFound('That person');

  const recruiterCompanyId = recruiterSnap.exists
    ? ((recruiterSnap.data() as RecruiterProfile).companyId ?? null)
    : null;
  const company = recruiterCompanyId ? await getCompany(recruiterCompanyId) : null;

  let profile: PublicProfile['profile'] = null;
  let profileHiddenReason: PublicProfile['profileHiddenReason'] = null;

  if (profileSnap.exists) {
    const raw = serialise<InternProfile>({ accountId, ...profileSnap.data() });
    profileHiddenReason = visibilityFor(
      raw.visibility,
      viewerId === accountId,
      person.relationship === 'connected',
      viewerRole === 'recruiter',
    );

    if (!profileHiddenReason) {
      profile = {
        about: raw.about,
        school: raw.school,
        location: raw.location,
        skills: raw.skills ?? [],
        education: raw.education ?? [],
        experience: raw.experience ?? [],
        certifications: raw.certifications ?? [],
        portfolioLinks: raw.portfolioLinks ?? [],
      };
    }
  }

  return {
    person,
    profile,
    profileHiddenReason,
    company: company
      ? {
          id: company.id,
          name: company.name,
          logoUrl: company.logoUrl,
          isVerified: company.verificationStatus === 'verified',
        }
      : null,
    stats: {
      followers: counts.followers,
      following: counts.following,
      connections: connections.length,
      posts: postCount.data().count,
    },
    joinedAt: account.createdAt,
  };
}
