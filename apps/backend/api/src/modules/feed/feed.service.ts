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
import { buildRelationshipResolver, followedIds } from '../connections/connections.service.js';
import { hydratePostAuthors } from '../posts/author-hydration.js';
import { bookmarkedPostIds, bookmarkedSet, sampleReactors } from '../posts/engagement.service.js';
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

/**
 * The candidate posts for a request, before any ranking.
 *
 * Four shapes, because they answer genuinely different questions. Only the
 * default one is a *feed* — a hashtag page, an author's posts and the saved
 * list are all chronological by nature, and ranking them would reorder a list
 * the user has an exact mental model of. They also cannot share the recency
 * window: your posts from last year still belong on your profile.
 */
async function loadCandidatePosts(
  accountId: string,
  query: FeedQuery,
  now: number,
): Promise<{ posts: Post[]; ranked: boolean }> {
  const collection = db().collection(Collections.posts);

  if (query.scope === 'saved') {
    const ids = await bookmarkedPostIds(accountId, Math.max(query.limit * 3, 60));
    if (ids.length === 0) return { posts: [], ranked: false };

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const snaps = await Promise.all(
      chunks.map((chunk) => collection.where('__name__', 'in', chunk).get()),
    );

    const byId = new Map(
      snaps
        .flatMap((snap) => snap.docs)
        .map((doc) => [doc.id, serialise<Post>({ id: doc.id, ...doc.data() })]),
    );
    // Saved order, not post order — a shortlist reads in the order it was built.
    return { posts: ids.map((id) => byId.get(id)).filter((p): p is Post => Boolean(p)), ranked: false };
  }

  if (query.authorId) {
    const snap = await collection
      .where('authorAccountId', '==', query.authorId)
      .orderBy('createdAt', 'desc')
      .limit(query.limit + 1)
      .get();
    return {
      posts: snap.docs.map((d) => serialise<Post>({ id: d.id, ...d.data() })),
      ranked: false,
    };
  }

  if (query.tag) {
    const snap = await collection
      .where('tags', 'array-contains', query.tag.replace(/^#/, '').toLowerCase())
      .orderBy('createdAt', 'desc')
      .limit(query.limit + 1)
      .get();
    return {
      posts: snap.docs.map((d) => serialise<Post>({ id: d.id, ...d.data() })),
      ranked: false,
    };
  }

  const since = new Date(now - FEED_WINDOW_DAYS * 86_400_000).toISOString();
  const snap = await collection
    .where('createdAt', '>=', since)
    .orderBy('createdAt', 'desc')
    .limit(FEED_CANDIDATE_POOL)
    .get();

  return { posts: snap.docs.map((d) => serialise<Post>({ id: d.id, ...d.data() })), ranked: true };
}

/**
 * Pulls the engagement numbers a reshare should display.
 *
 * A reshare's own counters are permanently zero — its likes and comments live
 * on the original (see `resolveInteractionTarget`). Showing those zeroes would
 * make every reshare look ignored, so the original's numbers are copied onto
 * the card. The reshare still renders as a reshare; only the count is borrowed.
 */
async function loadOriginals(posts: Post[]): Promise<Map<string, Post>> {
  const ids = [
    ...new Set(
      posts
        .map((post) => post.resharedFrom?.postId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const originals = new Map<string, Post>();
  if (ids.length === 0) return originals;

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      db().collection(Collections.posts).where('__name__', 'in', chunk).get(),
    ),
  );

  for (const snap of snaps) {
    for (const doc of snap.docs) {
      originals.set(doc.id, serialise<Post>({ id: doc.id, ...doc.data() }));
    }
  }

  return originals;
}

/** FR-1007 — the ranked activity feed. */
export async function getFeed(
  accountId: string,
  query: FeedQuery,
  now = Date.now(),
): Promise<{ items: FeedItem[]; hasMore: boolean }> {
  const [candidates, resolver, followed, profile, reactionsSnap, saved] = await Promise.all([
    loadCandidatePosts(accountId, query, now),
    buildRelationshipResolver(accountId),
    followedIds(accountId),
    getInternProfile(accountId).catch(() => null),
    db()
      .collection(Collections.postReactions)
      .where('accountId', '==', accountId)
      .limit(500)
      .get(),
    bookmarkedSet(accountId),
  ]);

  const reactedPostIds = new Set(reactionsSnap.docs.map((d) => d.data().postId as string));

  const rankable: RankablePost[] = candidates.posts.map((post) => {
    const relationship = resolver.relationshipTo(post.authorAccountId);
    const reason = resolveReason({
      relationship,
      followsAccount: followed.accounts.has(post.authorAccountId),
      followsCompany: Boolean(post.companyId && followed.companies.has(post.companyId)),
      sharesSchool: Boolean(
        profile?.school && post.author.headline?.toLowerCase().includes(profile.school.toLowerCase()),
      ),
      isOwnPost: post.authorAccountId === accountId,
    });
    return { post, reason, relationship };
  });

  let visible = filterVisible(rankable, resolver.blockedIds);

  // `following` is an explicit "only the people I chose" view. That drops the
  // global-popular backfill *and* your own posts: your feed is where you go to
  // read other people, and seeing yourself under "Following" reads as a bug
  // because you do not, in fact, follow yourself.
  if (query.scope === 'following') {
    visible = visible.filter((item) => item.reason !== 'popular' && item.reason !== 'your_post');
  }

  const ordered = candidates.ranked
    ? rankFeed(visible, now)
    : visible.map((item) => ({ ...item, score: 0 }));

  const page = ordered.slice(0, query.limit);

  // Author identity and engagement are resolved for the page, not the pool —
  // ranking discards most of what it reads, and paying to hydrate 300 posts to
  // render 20 is the kind of cost that never shows up in a single-user test.
  const [hydrated, originals] = await Promise.all([
    hydratePostAuthors(page.map((item) => item.post)),
    loadOriginals(page.map((item) => item.post)),
  ]);

  const withEngagement = hydrated.map((post) => {
    const original = post.resharedFrom ? originals.get(post.resharedFrom.postId) : undefined;
    const interactionPostId = original?.id ?? post.id;
    return {
      interactionPostId,
      post: original
        ? {
            ...post,
            reactionCount: original.reactionCount,
            commentCount: original.commentCount,
            shareCount: original.shareCount ?? 0,
            allowResharing: original.allowResharing,
          }
        : post,
    };
  });

  const reactors = await sampleReactors(
    [...new Set(withEngagement.map((entry) => entry.interactionPostId))],
    accountId,
  );

  return {
    items: page.map((item, index) => {
      const entry = withEngagement[index]!;
      return {
        post: entry.post,
        reason: item.reason,
        relationship: item.relationship,
        score: item.score,
        hasReacted: reactedPostIds.has(entry.interactionPostId),
        isBookmarked: saved.has(item.post.id),
        isFollowingAuthor:
          item.post.author.kind === 'company'
            ? followed.companies.has(item.post.author.id)
            : followed.accounts.has(item.post.author.id),
        interactionPostId: entry.interactionPostId,
        reactors: reactors.get(entry.interactionPostId) ?? [],
      };
    }),
    hasMore: ordered.length > query.limit,
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
