import {
  RANKING_CONFIG,
  type FeedReason,
  type Post,
  type Relationship,
} from '@internlink/shared-types';

/**
 * FR-1007 — activity feed ranking.
 *
 * Three multiplied terms rather than a weighted sum:
 *
 *   score = affinity × engagement × decay
 *
 * Multiplication is the right shape here because the terms are not
 * substitutes. A viral post from a stranger should not outrank a fresh post
 * from someone you actually know, and a weighted sum lets a large engagement
 * number buy its way past a low affinity. Multiplying means a near-zero on any
 * one term collapses the whole score, which is the behaviour we want.
 *
 * Pure functions, injected clock — same reasoning as matching.ts.
 */

const { gravity, affinity, authorDiversityDecay, commentWeight } = RANKING_CONFIG.feed;

/** How the viewer relates to a post's author, resolved to a feed reason. */
export function resolveReason(args: {
  relationship: Relationship;
  followsAccount: boolean;
  followsCompany: boolean;
  sharesSchool: boolean;
  isOwnPost: boolean;
}): FeedReason {
  if (args.isOwnPost) return 'your_post';
  if (args.relationship === 'connected') return 'connection';
  // An explicit follow outranks a company follow: the viewer chose this person
  // specifically, which is a stronger statement than following their employer.
  if (args.followsAccount) return 'following_account';
  if (args.followsCompany) return 'following_company';
  if (args.relationship === 'second_degree') return 'second_degree';
  if (args.sharesSchool) return 'same_school';
  return 'popular';
}

export function affinityScore(reason: FeedReason): number {
  return affinity[reason];
}

/**
 * Engagement, compressed logarithmically.
 *
 * Raw counts have a runaway problem: a post with 500 reactions would otherwise
 * score 100× a post with 5, and dominate the feed for days. log1p turns that
 * into roughly 2×, which reflects how much more *interesting* it actually is.
 *
 * Comments are weighted above reactions because they cost more to leave, so
 * they are a stronger signal that a post is worth reading.
 */
export function engagementScore(post: Pick<Post, 'reactionCount' | 'commentCount'>): number {
  const raw = post.reactionCount + commentWeight * post.commentCount;
  return 1 + Math.log1p(Math.max(0, raw));
}

/**
 * Time decay, Hacker News shaped: 1 / (hours + 2)^gravity.
 *
 * The +2 offset stops a brand-new post scoring infinity and gives everything a
 * roughly two-hour grace period at near-full strength.
 */
export function decayScore(createdAt: string, now: number): number {
  const ageMs = now - new Date(createdAt).getTime();
  if (Number.isNaN(ageMs)) return 0;
  const ageHours = Math.max(0, ageMs / 3_600_000);
  return 1 / Math.pow(ageHours + 2, gravity);
}

export interface RankablePost {
  post: Post;
  reason: FeedReason;
  relationship: Relationship;
}

export interface RankedPost extends RankablePost {
  score: number;
}

export function scorePost(item: RankablePost, now: number): number {
  return (
    affinityScore(item.reason) * engagementScore(item.post) * decayScore(item.post.createdAt, now)
  );
}

/**
 * Ranks, then breaks up author runs.
 *
 * Without the diversity pass, one prolific company posting five times in an
 * afternoon takes the whole first screen — technically correct by score, and a
 * feed nobody wants to read. Each subsequent post by an author already seen is
 * multiplied by the decay again, so a second post needs to be genuinely much
 * stronger to hold its place.
 *
 * Applied after scoring rather than as a hard cap, so a genuinely outstanding
 * second post can still surface.
 */
export function rankFeed(items: RankablePost[], now: number): RankedPost[] {
  const scored = items
    .map((item) => ({ ...item, score: scorePost(item, now) }))
    .sort((a, b) => b.score - a.score);

  const seenByAuthor = new Map<string, number>();
  const diversified: RankedPost[] = [];

  for (const item of scored) {
    const authorKey = `${item.post.author.kind}:${item.post.author.id}`;
    const seen = seenByAuthor.get(authorKey) ?? 0;
    seenByAuthor.set(authorKey, seen + 1);
    diversified.push({
      ...item,
      score: item.score * Math.pow(authorDiversityDecay, seen),
    });
  }

  return diversified.sort((a, b) => b.score - a.score);
}

/**
 * Blocked authors are removed outright, and a viewer never sees a post that has
 * been flagged and not yet cleared. Both are filters rather than score
 * penalties — there is no score at which showing them would be correct.
 */
export function filterVisible(items: RankablePost[], blockedIds: Set<string>): RankablePost[] {
  return items.filter(
    (item) => !item.post.isFlagged && !blockedIds.has(item.post.authorAccountId),
  );
}
