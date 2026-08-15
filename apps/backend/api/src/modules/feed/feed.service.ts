import type {
  Company,
  FeedItem,
  FeedQuery,
  Listing,
  MatchQuery,
  MatchResult,
  Post,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { docToEntity, serialise } from '../../lib/firestore.js';
import { notFound } from '../../lib/errors.js';
import { getInternProfile } from '../profiles/profiles.service.js';
import {
  buildRelationshipResolver,
  followedCompanyIds,
} from '../connections/connections.service.js';
import { canMatch, scoreListing } from './matching.js';
import { filterVisible, rankFeed, resolveReason, type RankablePost } from './ranking.js';

/**
 * Candidate pool size for a feed page.
 *
 * Fan-out-on-read: we pull recent posts and rank them per request, rather than
 * maintaining a materialised feed per user. That is the right call at launch —
 * fan-out-on-write costs a write per follower on every post, which is absurd
 * before there are followers to write to.
 *
 * It stops being the right call somewhere around a few hundred posts a day.
 * The signal to switch is this constant needing to grow to keep the feed
 * relevant: once 300 recent posts no longer contain enough that a given user
 * cares about, ranking a bigger pool is not the fix.
 */
const FEED_CANDIDATE_POOL = 300;
const FEED_WINDOW_DAYS = 30;

/** FR-1007 — the ranked activity feed. */
export async function getFeed(
  accountId: string,
  query: FeedQuery,
  now = Date.now(),
): Promise<{ items: FeedItem[]; hasMore: boolean }> {
  const since = new Date(now - FEED_WINDOW_DAYS * 86_400_000).toISOString();

  const [postsSnap, resolver, followed, profile, reactionsSnap] = await Promise.all([
    db()
      .collection(Collections.posts)
      .where('createdAt', '>=', since)
      .orderBy('createdAt', 'desc')
      .limit(FEED_CANDIDATE_POOL)
      .get(),
    buildRelationshipResolver(accountId),
    followedCompanyIds(accountId),
    getInternProfile(accountId).catch(() => null),
    db()
      .collection(Collections.postReactions)
      .where('accountId', '==', accountId)
      .limit(500)
      .get(),
  ]);

  const reactedPostIds = new Set(reactionsSnap.docs.map((d) => d.data().postId as string));

  const candidates: RankablePost[] = postsSnap.docs.map((doc) => {
    const post = serialise<Post>({ id: doc.id, ...doc.data() });
    const relationship = resolver.relationshipTo(post.authorAccountId);
    const reason = resolveReason({
      relationship,
      followsCompany: Boolean(post.companyId && followed.has(post.companyId)),
      sharesSchool: Boolean(
        profile?.school && post.author.headline?.toLowerCase().includes(profile.school.toLowerCase()),
      ),
      isOwnPost: post.authorAccountId === accountId,
    });
    return { post, reason, relationship };
  });

  let visible = filterVisible(candidates, resolver.blockedIds);

  // `following` drops the global-popular backfill — an explicit "only people
  // I chose" view, which is the whole reason to offer the toggle.
  if (query.scope === 'following') {
    visible = visible.filter((item) => item.reason !== 'popular');
  }

  const ranked = rankFeed(visible, now);
  const page = ranked.slice(0, query.limit);

  return {
    items: page.map((item) => ({
      post: item.post,
      reason: item.reason,
      relationship: item.relationship,
      score: item.score,
      hasReacted: reactedPostIds.has(item.post.id),
    })),
    hasMore: ranked.length > query.limit,
  };
}

/**
 * FR-204 — the ranked "Matches for you" feed.
 *
 * Same fan-out-on-read shape, same eventual limit: this scores every active
 * listing against one profile. At the §5.1 target of 50,000 active listings
 * that is far too much work per request, and matching needs to move to a
 * precomputed nightly pass writing per-user candidates. Until the catalogue is
 * in the low thousands, scoring live keeps matches instantly responsive to a
 * profile edit, which is worth more.
 */
export async function getMatches(
  accountId: string,
  query: MatchQuery,
  now = Date.now(),
): Promise<{ items: MatchResult[]; profileReady: boolean }> {
  const profile = await getInternProfile(accountId);
  if (!profile) throw notFound('Your profile');

  if (!canMatch(profile)) {
    // Not an error — the UI turns this into "add three skills to see matches",
    // which is a far better outcome than an empty list with no explanation.
    return { items: [], profileReady: false };
  }

  const [listingsSnap, appliedSnap] = await Promise.all([
    db()
      .collection(Collections.listings)
      .where('status', '==', 'active')
      .orderBy('publishedAt', 'desc')
      .limit(500)
      .get(),
    db()
      .collection(Collections.applications)
      .where('internAccountId', '==', accountId)
      .get(),
  ]);

  const appliedListingIds = new Set(appliedSnap.docs.map((d) => d.data().listingId as string));

  const listings = listingsSnap.docs.map((d) => serialise<Listing>({ id: d.id, ...d.data() }));

  // Company lookups are deduplicated and batched — one fetch per company, not
  // one per listing, which matters when a single employer posts twenty roles.
  const companyIds = [...new Set(listings.map((l) => l.companyId))];
  const companies = new Map<string, Company>();
  for (let i = 0; i < companyIds.length; i += 30) {
    const batch = companyIds.slice(i, i + 30);
    const snap = await db()
      .collection(Collections.companies)
      .where('__name__', 'in', batch)
      .get();
    for (const doc of snap.docs) {
      const company = docToEntity<Company>(doc);
      if (company) companies.set(company.id, company);
    }
  }

  const scored: MatchResult[] = [];

  for (const listing of listings) {
    const hasApplied = appliedListingIds.has(listing.id);
    if (hasApplied && !query.includeApplied) continue;

    const company = companies.get(listing.companyId) ?? null;
    const result = scoreListing({
      profile,
      listing,
      companyVerification: company?.verificationStatus ?? 'unsubmitted',
      hasApplied,
      now,
    });

    if (result.score < query.minScore) continue;

    scored.push({
      listing,
      company: company
        ? {
            id: company.id,
            name: company.name,
            logoUrl: company.logoUrl,
            isVerified: company.verificationStatus === 'verified',
          }
        : null,
      score: result.score,
      breakdown: result.breakdown,
      matchedSkills: result.matchedSkills,
      missingSkills: result.missingSkills,
      highlights: result.highlights,
      hasApplied,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  return { items: scored.slice(0, query.limit), profileReady: true };
}
