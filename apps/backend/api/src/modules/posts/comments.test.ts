import { describe, expect, it } from 'vitest';
import type { PostComment } from '@internlink/shared-types';
import { groupComments } from './posts.service.js';

function comment(overrides: Partial<PostComment> & { id: string }): PostComment {
  return {
    postId: 'post_1',
    author: {
      kind: 'account',
      id: 'acc_1',
      name: 'Ada Okonkwo',
      avatarUrl: null,
      headline: null,
      isVerified: false,
    },
    authorAccountId: 'acc_1',
    body: 'Nice work.',
    parentCommentId: null,
    mentions: [],
    likeCount: 0,
    replyCount: 0,
    createdAt: '2026-08-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('groupComments', () => {
  it('keeps top-level comments in the order they arrive', () => {
    const threads = groupComments(
      [comment({ id: 'c1' }), comment({ id: 'c2' }), comment({ id: 'c3' })],
      new Set(),
    );

    expect(threads.map((t) => t.id)).toEqual(['c1', 'c2', 'c3']);
    expect(threads.every((t) => t.replies.length === 0)).toBe(true);
  });

  it('attaches replies to their parent instead of listing them flat', () => {
    const threads = groupComments(
      [
        comment({ id: 'c1' }),
        comment({ id: 'r1', parentCommentId: 'c1' }),
        comment({ id: 'c2' }),
        comment({ id: 'r2', parentCommentId: 'c1' }),
      ],
      new Set(),
    );

    expect(threads.map((t) => t.id)).toEqual(['c1', 'c2']);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(threads[1]!.replies).toEqual([]);
  });

  it('groups a reply that arrives before its parent', () => {
    // Possible with clock skew across API instances, since ordering is by the
    // `createdAt` each instance stamped.
    const threads = groupComments(
      [comment({ id: 'r1', parentCommentId: 'c1' }), comment({ id: 'c1' })],
      new Set(),
    );

    expect(threads.map((t) => t.id)).toEqual(['c1']);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['r1']);
  });

  it('promotes an orphaned reply rather than dropping it', () => {
    // The parent fell outside the fetch window. Showing the reply out of place
    // beats silently losing it.
    const threads = groupComments(
      [comment({ id: 'c1' }), comment({ id: 'r1', parentCommentId: 'missing' })],
      new Set(),
    );

    expect(threads.map((t) => t.id)).toEqual(['c1', 'r1']);
  });

  it("resolves the viewer's like state on replies as well as parents", () => {
    const threads = groupComments(
      [comment({ id: 'c1' }), comment({ id: 'r1', parentCommentId: 'c1' })],
      new Set(['r1']),
    );

    expect(threads[0]!.hasLiked).toBe(false);
    expect(threads[0]!.replies[0]!.hasLiked).toBe(true);
  });

  it('defaults counters missing on comments written before likes existed', () => {
    const legacy = comment({ id: 'c1' });
    delete (legacy as Partial<PostComment>).likeCount;
    delete (legacy as Partial<PostComment>).replyCount;
    delete (legacy as Partial<PostComment>).parentCommentId;

    const [thread] = groupComments([legacy], new Set());

    expect(thread).toMatchObject({ likeCount: 0, replyCount: 0, parentCommentId: null });
  });

  it('returns nothing for an empty thread', () => {
    expect(groupComments([], new Set())).toEqual([]);
  });
});
