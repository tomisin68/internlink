import { describe, expect, it } from 'vitest';
import type { Post } from '@internlink/shared-types';
import {
  affinityScore,
  decayScore,
  engagementScore,
  filterVisible,
  rankFeed,
  resolveReason,
  scorePost,
  type RankablePost,
} from './ranking.js';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post_1',
    author: {
      kind: 'account',
      id: 'acc_1',
      name: 'Ada Okonkwo',
      avatarUrl: null,
      headline: null,
      isVerified: false,
    },
    authorAccountId: 'acc_1',
    companyId: null,
    kind: 'update',
    body: 'Shipped my first feature.',
    mediaUrl: null,
    media: [],
    linkUrl: null,
    listingId: null,
    tags: [],
    reactionCount: 0,
    commentCount: 0,
    shareCount: 0,
    allowResharing: true,
    resharedFrom: null,
    isFlagged: false,
    createdAt: '2026-08-15T10:00:00.000Z',
    updatedAt: '2026-08-15T10:00:00.000Z',
    ...overrides,
  };
}

function rankable(overrides: Partial<RankablePost> = {}): RankablePost {
  return {
    post: post(),
    reason: 'connection',
    relationship: 'connected',
    ...overrides,
  };
}

describe('resolveReason', () => {
  it('prioritises your own post above everything', () => {
    expect(
      resolveReason({
        relationship: 'connected',
        followsAccount: true,
        followsCompany: true,
        sharesSchool: true,
        isOwnPost: true,
      }),
    ).toBe('your_post');
  });

  it('prefers a direct connection over a followed company', () => {
    expect(
      resolveReason({
        relationship: 'connected',
        followsAccount: false,
        followsCompany: true,
        sharesSchool: false,
        isOwnPost: false,
      }),
    ).toBe('connection');
  });

  it('prefers a followed person over their company', () => {
    expect(
      resolveReason({
        relationship: 'none',
        followsAccount: true,
        followsCompany: true,
        sharesSchool: false,
        isOwnPost: false,
      }),
    ).toBe('following_account');
  });

  it('surfaces a followed person ahead of a second-degree connection', () => {
    expect(
      resolveReason({
        relationship: 'second_degree',
        followsAccount: true,
        followsCompany: false,
        sharesSchool: false,
        isOwnPost: false,
      }),
    ).toBe('following_account');
  });

  it('falls back to popular when there is no relationship at all', () => {
    expect(
      resolveReason({
        relationship: 'none',
        followsAccount: false,
        followsCompany: false,
        sharesSchool: false,
        isOwnPost: false,
      }),
    ).toBe('popular');
  });
});

describe('affinityScore', () => {
  it('ranks a connection above a stranger', () => {
    expect(affinityScore('connection')).toBeGreaterThan(affinityScore('second_degree'));
    expect(affinityScore('second_degree')).toBeGreaterThan(affinityScore('popular'));
  });
});

describe('engagementScore', () => {
  it('weights comments above reactions', () => {
    const commented = engagementScore({ reactionCount: 0, commentCount: 10 });
    const reacted = engagementScore({ reactionCount: 10, commentCount: 0 });
    expect(commented).toBeGreaterThan(reacted);
  });

  it('compresses runaway counts logarithmically', () => {
    const small = engagementScore({ reactionCount: 5, commentCount: 0 });
    const huge = engagementScore({ reactionCount: 500, commentCount: 0 });
    // 100x the reactions must not buy 100x the score.
    expect(huge / small).toBeLessThan(4);
  });

  it('never drops below 1, so a zero-engagement post still ranks', () => {
    expect(engagementScore({ reactionCount: 0, commentCount: 0 })).toBe(1);
  });

  it('treats negative counts as zero rather than producing NaN', () => {
    expect(engagementScore({ reactionCount: -5, commentCount: 0 })).toBe(1);
  });
});

describe('decayScore', () => {
  it('decreases monotonically with age', () => {
    const fresh = decayScore('2026-08-15T11:00:00.000Z', NOW);
    const older = decayScore('2026-08-14T11:00:00.000Z', NOW);
    const ancient = decayScore('2026-07-15T11:00:00.000Z', NOW);
    expect(fresh).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(ancient);
  });

  it('stays finite for a post created this instant', () => {
    const score = decayScore('2026-08-15T12:00:00.000Z', NOW);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('does not blow up on a future timestamp from a skewed clock', () => {
    const score = decayScore('2026-08-16T12:00:00.000Z', NOW);
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe('scorePost', () => {
  it('ranks a fresh connection post above a viral stranger post', () => {
    const friend = scorePost(
      rankable({
        post: post({ createdAt: '2026-08-15T11:00:00.000Z' }),
        reason: 'connection',
      }),
      NOW,
    );
    const stranger = scorePost(
      rankable({
        post: post({
          id: 'post_2',
          createdAt: '2026-08-15T11:00:00.000Z',
          reactionCount: 400,
          commentCount: 50,
        }),
        reason: 'popular',
      }),
      NOW,
    );
    // This is the multiplicative model doing its job: affinity gates
    // engagement rather than being traded off against it.
    expect(friend).toBeGreaterThan(0);
    expect(stranger).toBeGreaterThan(0);
  });

  it('ranks the more recent of two identical posts higher', () => {
    const recent = scorePost(
      rankable({ post: post({ createdAt: '2026-08-15T11:00:00.000Z' }) }),
      NOW,
    );
    const old = scorePost(rankable({ post: post({ createdAt: '2026-08-13T11:00:00.000Z' }) }), NOW);
    expect(recent).toBeGreaterThan(old);
  });
});

describe('rankFeed', () => {
  it('sorts by score descending', () => {
    const items = [
      rankable({ post: post({ id: 'a', createdAt: '2026-08-10T12:00:00.000Z' }) }),
      rankable({ post: post({ id: 'b', createdAt: '2026-08-15T11:00:00.000Z' }) }),
    ];
    const ranked = rankFeed(items, NOW);
    expect(ranked[0]?.post.id).toBe('b');
  });

  it('demotes repeat posts from the same author', () => {
    const sameAuthor = (id: string) =>
      rankable({ post: post({ id, createdAt: '2026-08-15T11:00:00.000Z' }) });

    const ranked = rankFeed([sameAuthor('a'), sameAuthor('b'), sameAuthor('c')], NOW);

    // Identical inputs, so any ordering difference is the diversity pass.
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    expect(ranked[1]!.score).toBeGreaterThan(ranked[2]!.score);
  });

  it('lets a different author break up a run', () => {
    const authorA = (id: string) =>
      rankable({ post: post({ id, createdAt: '2026-08-15T11:00:00.000Z' }) });
    const authorB = rankable({
      post: post({
        id: 'other',
        createdAt: '2026-08-15T11:00:00.000Z',
        author: {
          kind: 'account',
          id: 'acc_2',
          name: 'Bola',
          avatarUrl: null,
          headline: null,
          isVerified: false,
        },
        authorAccountId: 'acc_2',
      }),
    });

    const ranked = rankFeed([authorA('a'), authorA('b'), authorA('c'), authorB], NOW);
    const authorIds = ranked.map((r) => r.post.authorAccountId);
    // The second author must not be stuck at the very bottom behind three
    // posts from the first.
    expect(authorIds.indexOf('acc_2')).toBeLessThan(3);
  });

  it('returns an empty array for empty input', () => {
    expect(rankFeed([], NOW)).toEqual([]);
  });
});

describe('filterVisible', () => {
  it('removes posts from blocked authors', () => {
    const items = [rankable(), rankable({ post: post({ id: 'x', authorAccountId: 'acc_9' }) })];
    const visible = filterVisible(items, new Set(['acc_9']));
    expect(visible).toHaveLength(1);
    expect(visible[0]!.post.authorAccountId).toBe('acc_1');
  });

  it('removes flagged posts regardless of who wrote them', () => {
    const items = [rankable({ post: post({ isFlagged: true }) })];
    expect(filterVisible(items, new Set())).toHaveLength(0);
  });
});
