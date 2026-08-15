import { FieldValue } from 'firebase-admin/firestore';
import type {
  CreateCommentInput,
  CreatePostInput,
  Post,
  PostAuthor,
  PostComment,
  PostCommentThread,
  PostCommentView,
  PostMedia,
  ResharePostInput,
  ResharedPost,
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

export async function createPost(accountId: string, input: CreatePostInput): Promise<Post> {
  await consumeQuota(accountId, 'post');

  const { author, companyId } = await buildAuthor(accountId, input.asCompany);
  const scan = scanForScamPatterns(input.body);
  const { media, mediaUrl } = normaliseMedia(input);
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
    tags: input.tags,
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

  return { id: ref.id, ...post };
}

export async function getPost(postId: string): Promise<Post | null> {
  return docToEntity<Post>(await db().collection(Collections.posts).doc(postId).get());
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
    tags: [],
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
      payload: { postId: root.postId, resharePostId: ref.id, byAccountId: accountId },
    });
  }

  return { id: ref.id, ...post };
}

/**
 * Reactions are one-per-account, enforced by a deterministic document ID.
 *
 * Toggling is idempotent as a result: a double-tap on a flaky connection
 * cannot leave a post with two reactions from the same person.
 */
export async function toggleReaction(
  accountId: string,
  postId: string,
): Promise<{ hasReacted: boolean; reactionCount: number }> {
  const post = await getPost(postId);
  if (!post) throw notFound('That post');

  const reactionRef = db().collection(Collections.postReactions).doc(`${postId}__${accountId}`);
  const postRef = db().collection(Collections.posts).doc(postId);

  const existing = await reactionRef.get();

  if (existing.exists) {
    const batch = db().batch();
    batch.delete(reactionRef);
    batch.update(postRef, { reactionCount: FieldValue.increment(-1) });
    await batch.commit();
    return { hasReacted: false, reactionCount: Math.max(0, post.reactionCount - 1) };
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

  return { hasReacted: true, reactionCount: post.reactionCount + 1 };
}

function commentsRef(postId: string) {
  return db().collection(Collections.posts).doc(postId).collection(Collections.comments);
}

export async function addComment(
  accountId: string,
  postId: string,
  input: CreateCommentInput,
): Promise<PostComment> {
  const post = await getPost(postId);
  if (!post) throw notFound('That post');

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

  const { author } = await buildAuthor(accountId, false);
  const ts = nowIso();

  const comment: Omit<PostComment, 'id'> = {
    postId,
    author,
    authorAccountId: accountId,
    body: input.body,
    parentCommentId,
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
      payload: { postId, commentId: ref.id, byAccountId: accountId, isReply: Boolean(parentCommentId) },
    });
  }

  return { id: ref.id, ...comment };
}

export async function deleteComment(
  accountId: string,
  postId: string,
  commentId: string,
): Promise<void> {
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
  postId: string,
  commentId: string,
): Promise<{ hasLiked: boolean; likeCount: number }> {
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
  postId: string,
  limit: number,
  viewerId: string | null,
): Promise<PostCommentThread[]> {
  const snap = await commentsRef(postId).orderBy('createdAt', 'asc').limit(limit).get();

  const comments = snap.docs.map((d) => serialise<PostComment>({ id: d.id, ...d.data() }));
  if (comments.length === 0) return [];

  const liked = viewerId ? await likedCommentIds(viewerId, postId) : new Set<string>();
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
