import { FieldValue } from 'firebase-admin/firestore';
import {
  MAX_POST_TAGS,
  extractHashtags,
  type CreateCommentInput,
  type CreatePostInput,
  type Mention,
  type Post,
  type PostAuthor,
  type PostComment,
  type PostCommentThread,
  type PostCommentView,
  type PostMedia,
  type ResharePostInput,
  type ResharedPost,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { docToEntity, nowIso, serialise } from '../../lib/firestore.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { consumeQuota } from '../../lib/daily-quota.js';
import { getAccount } from '../auth/auth.service.js';
import { getInternProfile } from '../profiles/profiles.service.js';
import { getCompany, getRecruiterProfile } from '../companies/companies.service.js';
import { scanForScamPatterns } from '../moderation/scam-detection.js';
import { autoFlag } from '../moderation/moderation.service.js';
import { emit } from '../notifications/events.js';
import { notifyFollowersOfPost } from '../notifications/fanout.service.js';
import { hydrateCommentAuthors } from './author-hydration.js';
import { resolveMentions } from './engagement.service.js';

/**
 * Builds the denormalised author block stamped onto every post.
 *
 * See the note on `PostAuthorSchema`: this is a deliberate read/write trade.
 * The cost is that renaming a company needs a backfill over its posts.
 */
async function buildAuthor(accountId: string, asCompany: boolean): Promise<{
  author: PostAuthor;
  companyId: string | null;
}> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('Your account');

  if (asCompany) {
    const recruiter = await getRecruiterProfile(accountId);
    if (!recruiter?.companyId) throw forbidden('You do not have a company to post as.');
    if (recruiter.companyRole === 'viewer') throw forbidden('Viewers cannot post.');

    const company = await getCompany(recruiter.companyId);
    if (!company) throw notFound('Your company');

    return {
      companyId: company.id,
      author: {
        kind: 'company',
        id: company.id,
        name: company.name,
        avatarUrl: company.logoUrl,
        headline: company.industry,
        isVerified: company.verificationStatus === 'verified',
      },
    };
  }

  const profile = await getInternProfile(accountId).catch(() => null);
  return {
    companyId: null,
    author: {
      kind: 'account',
      id: accountId,
      name: account.displayName || `${account.firstName} ${account.lastName}`.trim(),
      avatarUrl: account.photoUrl,
      headline: profile?.headline ?? null,
      isVerified: account.verificationTiers.length > 0,
    },
  };
}

/**
 * Reconciles the carousel with the legacy single-image field.
 *
 * `mediaUrl` predates carousels and is still read by anything rendering an old
 * post, so a new post fills it with its first still image. Videos are skipped:
 * a consumer that only understands `mediaUrl` will render it in an `<img>`.
 */
function normaliseMedia(input: Pick<CreatePostInput, 'media' | 'mediaUrl'>): {
  media: PostMedia[];
  mediaUrl: string | null;
} {
  const media: PostMedia[] = [...input.media];

  // An older client that only knows `mediaUrl` still gets a working carousel.
  if (media.length === 0 && input.mediaUrl) {
    media.push({
      kind: 'image',
      url: input.mediaUrl,
      thumbnailUrl: null,
      width: null,
      height: null,
      durationSeconds: null,
    });
  }

  const firstImage = media.find((item) => item.kind === 'image');
  return { media, mediaUrl: firstImage?.url ?? input.mediaUrl ?? null };
}

/**
 * Merges hashtags typed into the body with any picked from the composer.
 *
 * Someone writing "#lagos" mid-sentence plainly means it as a topic. Asking
 * them to also add it to a separate tag field is duplication people skip, and
 * then the post is untaggable through the one route they actually used.
 */
function resolveTags(body: string, explicit: string[]): string[] {
  const normalise = (tag: string) => tag.trim().replace(/^#/, '').toLowerCase();
  return [...new Set([...explicit.map(normalise), ...extractHashtags(body)])]
    .filter(Boolean)
    .slice(0, MAX_POST_TAGS);
}

/** Tells everyone tagged in a body that they were, except the author. */
function notifyMentions(args: {
  mentions: Mention[];
  byAccountId: string;
  postId: string;
  commentId?: string;
  preview: string;
}): void {
  for (const mention of args.mentions) {
    if (mention.accountId === args.byAccountId) continue;
    void emit({
      accountId: mention.accountId,
      type: 'mention',
      payload: {
        postId: args.postId,
        commentId: args.commentId ?? null,
        byAccountId: args.byAccountId,
        preview: args.preview.slice(0, 160),
      },
    });
  }
}

export async function createPost(accountId: string, input: CreatePostInput): Promise<Post> {
  await consumeQuota(accountId, 'post');

  const { author, companyId } = await buildAuthor(accountId, input.asCompany);
  const scan = scanForScamPatterns(input.body);
  const { media, mediaUrl } = normaliseMedia(input);
  const mentions = await resolveMentions(accountId, input.body);
  const ts = nowIso();

  const post: Omit<Post, 'id'> = {
    author,
    authorAccountId: accountId,
    companyId,
    kind: input.kind,
    body: input.body,
    mediaUrl,
    media,
    linkUrl: input.linkUrl ?? null,
    listingId: input.listingId ?? null,
    tags: resolveTags(input.body, input.tags),
    mentions,
    reactionCount: 0,
    commentCount: 0,
    shareCount: 0,
    allowResharing: input.allowResharing,
    resharedFrom: null,
    // A critical hit hides the post pending review; anything lesser stays up
    // and is queued. Public, permanent content earns a stricter default than a
    // private message does.
    isFlagged: scan.severity === 'critical',
    createdAt: ts,
    updatedAt: ts,
  };

  const ref = await db().collection(Collections.posts).add(post);
  const created: Post = { id: ref.id, ...post };

  if (scan.isFlagged && scan.severity) {
    void autoFlag({
      targetType: 'post',
      targetId: ref.id,
      severity: scan.severity,
      matchedRules: scan.matchedRuleIds,
      labels: scan.labels,
      authorId: accountId,
    });
  }

  // Detached: the author should not wait on their followers' devices, and a
  // post held back pending review should not announce itself.
  if (!created.isFlagged) {
    void notifyFollowersOfPost(created);
    notifyMentions({
      mentions,
      byAccountId: accountId,
      postId: ref.id,
      preview: input.body,
    });
  }

  return created;
}

export async function getPost(postId: string): Promise<Post | null> {
  return docToEntity<Post>(await db().collection(Collections.posts).doc(postId).get());
}

/**
 * The post an interaction actually belongs to.
 *
 * FR-1007 — liking a reshare likes the *original*. The alternative splits one
 * conversation across every copy of it: the author of the thing everybody is
 * reacting to sees none of it, and a reader has to visit five reshares to find
 * the discussion. Resolving it server-side means every client gets this right
 * without having to know the rule, and a like placed on a reshare before this
 * shipped still points where it always did.
 *
 * The reshare keeps its own `shareCount` and its own attribution — it is still
 * visibly *your* reshare, it just does not fork the engagement.
 */
export async function resolveInteractionTarget(postId: string): Promise<Post> {
  const post = await getPost(postId);
  if (!post) throw notFound('That post');
  if (!post.resharedFrom) return post;

  const original = await getPost(post.resharedFrom.postId);
  // The original may have been deleted since. The reshare's snapshot is then
  // the only surviving copy, so its own document takes the interaction rather
  // than the like silently failing.
  return original ?? post;
}

/** The author's own controls. Currently just the reshare switch (FR-1007). */
export async function updatePost(
  accountId: string,
  postId: string,
  patch: { allowResharing: boolean },
): Promise<Post> {
  const post = await getPost(postId);
  if (!post) throw notFound('That post');
  if (post.authorAccountId !== accountId) throw forbidden('That post is not yours.');

  const updatedAt = nowIso();
  await db()
    .collection(Collections.posts)
    .doc(postId)
    .update({ allowResharing: patch.allowResharing, updatedAt });

  // Switching resharing off is not retroactive. Reshares already out there stay
  // up: they are other people's posts, and silently deleting them would be a
  // far stranger outcome than the original author's preference changing from
  // here on.
  return { ...post, allowResharing: patch.allowResharing, updatedAt };
}

export async function deletePost(accountId: string, postId: string): Promise<void> {
  const post = await getPost(postId);
  if (!post) throw notFound('That post');
  if (post.authorAccountId !== accountId) throw forbidden('That post is not yours.');

  const batch = db().batch();
  batch.delete(db().collection(Collections.posts).doc(postId));

  // Deleting a reshare gives the original its count back, so the number on the
  // original post keeps meaning "reshares that currently exist".
  if (post.resharedFrom) {
    batch.update(db().collection(Collections.posts).doc(post.resharedFrom.postId), {
      shareCount: FieldValue.increment(-1),
    });
  }

  await batch.commit();
}

/**
 * FR-1007 — reshares a post, optionally with a comment on top.
 *
 * A reshare of a reshare attaches to the *original*, never to the intermediate
 * post. Chained quoting produces cards nested three deep that nobody can read
 * on a phone, and the second-hand attribution is wrong anyway — the content is
 * the original author's.
 */
export async function resharePost(
  accountId: string,
  postId: string,
  input: ResharePostInput,
): Promise<Post> {
  const source = await getPost(postId);
  if (!source) throw notFound('That post');
  if (source.isFlagged) throw forbidden('That post is under review.');

  // Follow through to the root so the snapshot credits whoever wrote it.
  const original = source.resharedFrom
    ? (await getPost(source.resharedFrom.postId)) ?? null
    : source;

  // The root may have been deleted since; the snapshot on the reshare is then
  // the only surviving copy, and it is enough to quote from.
  const root: ResharedPost = original
    ? {
        postId: original.id,
        author: original.author,
        authorAccountId: original.authorAccountId,
        body: original.body,
        media: original.media ?? [],
        createdAt: original.createdAt,
      }
    : source.resharedFrom!;

  if (original && !original.allowResharing) {
    throw forbidden('The author has turned off resharing for this post.');
  }
  if (root.authorAccountId === accountId && !input.body) {
    throw conflict('This is already your post.');
  }

  await consumeQuota(accountId, 'post');

  const { author, companyId } = await buildAuthor(accountId, input.asCompany);
  const scan = scanForScamPatterns(input.body);
  const ts = nowIso();

  const post: Omit<Post, 'id'> = {
    author,
    authorAccountId: accountId,
    companyId,
    kind: 'update',
    body: input.body,
    // A reshare's own media is empty — what it shows comes from the snapshot.
    mediaUrl: null,
    media: [],
    linkUrl: null,
    listingId: null,
    tags: resolveTags(input.body, []),
    mentions: await resolveMentions(accountId, input.body),
    // A reshare's likes and comments belong to the original — see
    // `resolveInteractionTarget`. Its own counters stay at zero and are never
    // incremented, which is what keeps "12 likes" meaning one number.
    reactionCount: 0,
    commentCount: 0,
    shareCount: 0,
    allowResharing: true,
    resharedFrom: root,
    isFlagged: scan.severity === 'critical',
    createdAt: ts,
    updatedAt: ts,
  };

  const ref = await db().collection(Collections.posts).add(post);
  const created: Post = { id: ref.id, ...post };

  // Best-effort: the original may have been deleted between the read and here,
  // and a missing counter is not worth failing the reshare over.
  void db()
    .collection(Collections.posts)
    .doc(root.postId)
    .update({ shareCount: FieldValue.increment(1) })
    .catch(() => undefined);

  if (root.authorAccountId !== accountId) {
    void emit({
      accountId: root.authorAccountId,
      type: 'post_reshare',
      payload: {
        postId: root.postId,
        resharePostId: ref.id,
        byAccountId: accountId,
        preview: input.body.slice(0, 160),
      },
    });
  }

  if (!created.isFlagged) void notifyFollowersOfPost(created);

  return created;
}

/** Whether this viewer has reacted to a post — needed by the permalink view. */
export async function hasReacted(accountId: string, postId: string): Promise<boolean> {
  const snap = await db()
    .collection(Collections.postReactions)
    .doc(`${postId}__${accountId}`)
    .get();
  return snap.exists;
}

/**
 * Reactions are one-per-account, enforced by a deterministic document ID.
 *
 * Toggling is idempotent as a result: a double-tap on a flaky connection
 * cannot leave a post with two reactions from the same person.
 *
 * A reaction placed on a reshare lands on the original — see
 * `resolveInteractionTarget`. The returned `postId` says which post actually
 * took it, so the caller can update the right cache entry.
 */
export async function toggleReaction(
  accountId: string,
  requestedPostId: string,
): Promise<{ hasReacted: boolean; reactionCount: number; postId: string }> {
  const post = await resolveInteractionTarget(requestedPostId);
  const postId = post.id;

  const reactionRef = db().collection(Collections.postReactions).doc(`${postId}__${accountId}`);
  const postRef = db().collection(Collections.posts).doc(postId);

  const existing = await reactionRef.get();

  if (existing.exists) {
    const batch = db().batch();
    batch.delete(reactionRef);
    batch.update(postRef, { reactionCount: FieldValue.increment(-1) });
    await batch.commit();
    return { hasReacted: false, reactionCount: Math.max(0, post.reactionCount - 1), postId };
  }

  const batch = db().batch();
  batch.set(reactionRef, { postId, accountId, createdAt: nowIso() });
  batch.update(postRef, { reactionCount: FieldValue.increment(1) });
  await batch.commit();

  if (post.authorAccountId !== accountId) {
    void emit({
      accountId: post.authorAccountId,
      type: 'post_reaction',
      payload: { postId, byAccountId: accountId },
    });
  }

  return { hasReacted: true, reactionCount: post.reactionCount + 1, postId };
}

function commentsRef(postId: string) {
  return db().collection(Collections.posts).doc(postId).collection(Collections.comments);
}

export async function addComment(
  accountId: string,
  requestedPostId: string,
  input: CreateCommentInput,
): Promise<PostComment> {
  // A comment left on a reshare belongs on the original, for the same reason a
  // reaction does — see `resolveInteractionTarget`.
  const post = await resolveInteractionTarget(requestedPostId);
  const postId = post.id;

  // Replies are one level deep — replying to a reply attaches to its parent.
  // See the note on `parentCommentId`; resolving it here rather than in the UI
  // means every client agrees on the shape without having to know the rule.
  let parentCommentId: string | null = null;
  let notify = post.authorAccountId;

  if (input.parentCommentId) {
    const parentSnap = await commentsRef(postId).doc(input.parentCommentId).get();
    if (!parentSnap.exists) throw notFound('That comment');
    const parent = serialise<PostComment>({ id: parentSnap.id, ...parentSnap.data() });
    parentCommentId = parent.parentCommentId ?? parent.id;
    // A reply notifies whoever you were replying to, not the post author.
    notify = parent.authorAccountId;
  }

  const [{ author }, mentions] = await Promise.all([
    buildAuthor(accountId, false),
    resolveMentions(accountId, input.body),
  ]);
  const ts = nowIso();

  const comment: Omit<PostComment, 'id'> = {
    postId,
    author,
    authorAccountId: accountId,
    body: input.body,
    parentCommentId,
    mentions,
    likeCount: 0,
    replyCount: 0,
    createdAt: ts,
  };

  const ref = await commentsRef(postId).doc();
  const batch = db().batch();
  batch.set(ref, comment);
  batch.update(db().collection(Collections.posts).doc(postId), {
    // Counts every comment, replies included — that is the number the button
    // shows, and "3 comments" hiding two replies reads as a bug.
    commentCount: FieldValue.increment(1),
    updatedAt: ts,
  });
  if (parentCommentId) {
    batch.update(commentsRef(postId).doc(parentCommentId), {
      replyCount: FieldValue.increment(1),
    });
  }
  await batch.commit();

  if (notify !== accountId) {
    void emit({
      accountId: notify,
      type: 'post_comment',
      payload: {
        postId,
        commentId: ref.id,
        byAccountId: accountId,
        isReply: Boolean(parentCommentId),
        // The preview is what turns "someone commented" into something worth
        // opening — and on a phone it is often the whole comment.
        preview: input.body.slice(0, 160),
      },
    });
  }

  // Tagged people hear about it even when they are not the post author, but
  // never twice: whoever was already notified above is skipped.
  notifyMentions({
    mentions: mentions.filter((m) => m.accountId !== notify),
    byAccountId: accountId,
    postId,
    commentId: ref.id,
    preview: input.body,
  });

  return { id: ref.id, ...comment };
}

export async function deleteComment(
  accountId: string,
  requestedPostId: string,
  commentId: string,
): Promise<void> {
  const postId = (await resolveInteractionTarget(requestedPostId)).id;
  const snap = await commentsRef(postId).doc(commentId).get();
  if (!snap.exists) throw notFound('That comment');
  const comment = serialise<PostComment>({ id: snap.id, ...snap.data() });

  // The post's author moderates their own thread; otherwise it is yours or it
  // is not yours to delete.
  const post = await getPost(postId);
  const isPostAuthor = post?.authorAccountId === accountId;
  if (comment.authorAccountId !== accountId && !isPostAuthor) {
    throw forbidden('That comment is not yours.');
  }

  const removed = 1 + (comment.replyCount ?? 0);
  const batch = db().batch();
  batch.delete(commentsRef(postId).doc(commentId));
  batch.update(db().collection(Collections.posts).doc(postId), {
    commentCount: FieldValue.increment(-removed),
    updatedAt: nowIso(),
  });
  if (comment.parentCommentId) {
    batch.update(commentsRef(postId).doc(comment.parentCommentId), {
      replyCount: FieldValue.increment(-1),
    });
  }
  await batch.commit();

  // Orphaned replies are swept separately rather than inside the batch: a
  // 500-limit batch cannot promise to hold an unbounded reply list.
  if (!comment.parentCommentId && removed > 1) {
    const replies = await commentsRef(postId).where('parentCommentId', '==', commentId).get();
    await Promise.all(replies.docs.map((d) => d.ref.delete()));
  }
}

/**
 * Likes on a comment, one per account, deterministic ID.
 *
 * Same shape as post reactions and for the same reason: a double-tap on a
 * flaky connection must not be able to leave two likes behind.
 */
export async function toggleCommentReaction(
  accountId: string,
  requestedPostId: string,
  commentId: string,
): Promise<{ hasLiked: boolean; likeCount: number }> {
  const postId = (await resolveInteractionTarget(requestedPostId)).id;
  const snap = await commentsRef(postId).doc(commentId).get();
  if (!snap.exists) throw notFound('That comment');
  const comment = serialise<PostComment>({ id: snap.id, ...snap.data() });

  const likeRef = db()
    .collection(Collections.commentReactions)
    .doc(`${postId}__${commentId}__${accountId}`);
  const existing = await likeRef.get();
  const commentRef = commentsRef(postId).doc(commentId);
  const batch = db().batch();

  if (existing.exists) {
    batch.delete(likeRef);
    batch.update(commentRef, { likeCount: FieldValue.increment(-1) });
    await batch.commit();
    return { hasLiked: false, likeCount: Math.max(0, (comment.likeCount ?? 0) - 1) };
  }

  batch.set(likeRef, { postId, commentId, accountId, createdAt: nowIso() });
  batch.update(commentRef, { likeCount: FieldValue.increment(1) });
  await batch.commit();

  if (comment.authorAccountId !== accountId) {
    void emit({
      accountId: comment.authorAccountId,
      type: 'comment_reaction',
      payload: { postId, commentId, byAccountId: accountId },
    });
  }

  return { hasLiked: true, likeCount: (comment.likeCount ?? 0) + 1 };
}

/**
 * Groups a flat comment list into top-level comments with their replies.
 *
 * Pure and exported so the grouping rules are testable without Firestore — the
 * orphan case below is the kind of thing that only shows up on a busy post.
 *
 * A reply whose parent fell outside the fetch window is promoted to top level
 * rather than dropped: showing a comment slightly out of place is a much better
 * failure than losing it, and the alternative is a thread that silently omits
 * replies once a post gets popular.
 */
export function groupComments(
  comments: PostComment[],
  likedIds: ReadonlySet<string>,
): PostCommentThread[] {
  const toView = (comment: PostComment): PostCommentView => ({
    ...comment,
    parentCommentId: comment.parentCommentId ?? null,
    mentions: comment.mentions ?? [],
    likeCount: comment.likeCount ?? 0,
    replyCount: comment.replyCount ?? 0,
    hasLiked: likedIds.has(comment.id),
  });

  const byId = new Map(comments.map((c) => [c.id, c]));
  const threads = new Map<string, PostCommentThread>();

  // Two passes so a reply that arrives before its parent in `createdAt` order —
  // possible with clock skew across instances — still lands in the right thread.
  for (const comment of comments) {
    if (!comment.parentCommentId || !byId.has(comment.parentCommentId)) {
      threads.set(comment.id, { ...toView(comment), replies: [] });
    }
  }

  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    threads.get(comment.parentCommentId)?.replies.push(toView(comment));
  }

  return [...threads.values()];
}

/**
 * The comment thread for a post.
 *
 * One query for the whole thread rather than one per parent: at these volumes
 * the grouping is cheaper in memory than it is in round trips, and a comment
 * section that loads in N+1 requests is the reason comment sections feel slow.
 */
export async function listComments(
  requestedPostId: string,
  limit: number,
  viewerId: string | null,
): Promise<PostCommentThread[]> {
  // Opening the comments on a reshare shows the original's thread — that is
  // where the conversation is. See `resolveInteractionTarget`.
  const postId = (await resolveInteractionTarget(requestedPostId)).id;
  const snap = await commentsRef(postId).orderBy('createdAt', 'asc').limit(limit).get();

  const raw = snap.docs.map((d) => serialise<PostComment>({ id: d.id, ...d.data() }));
  if (raw.length === 0) return [];

  // Authors are re-resolved for the same reason posts' are: a commenter who
  // added a photo after commenting should not be stuck as initials.
  const [comments, liked] = await Promise.all([
    hydrateCommentAuthors(raw),
    viewerId ? likedCommentIds(viewerId, postId) : Promise.resolve(new Set<string>()),
  ]);

  return groupComments(comments, liked);
}

async function likedCommentIds(accountId: string, postId: string): Promise<Set<string>> {
  const snap = await db()
    .collection(Collections.commentReactions)
    .where('accountId', '==', accountId)
    .where('postId', '==', postId)
    .get();
  return new Set(snap.docs.map((d) => d.data().commentId as string));
}
