import { FieldValue } from 'firebase-admin/firestore';
import type {
  CreateCommentInput,
  CreatePostInput,
  Post,
  PostAuthor,
  PostComment,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { docToEntity, nowIso, serialise } from '../../lib/firestore.js';
import { forbidden, notFound } from '../../lib/errors.js';
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

export async function createPost(accountId: string, input: CreatePostInput): Promise<Post> {
  await consumeQuota(accountId, 'post');

  const { author, companyId } = await buildAuthor(accountId, input.asCompany);
  const scan = scanForScamPatterns(input.body);
  const ts = nowIso();

  const post: Omit<Post, 'id'> = {
    author,
    authorAccountId: accountId,
    companyId,
    kind: input.kind,
    body: input.body,
    mediaUrl: input.mediaUrl ?? null,
    linkUrl: input.linkUrl ?? null,
    listingId: input.listingId ?? null,
    tags: input.tags,
    reactionCount: 0,
    commentCount: 0,
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

export async function deletePost(accountId: string, postId: string): Promise<void> {
  const post = await getPost(postId);
  if (!post) throw notFound('That post');
  if (post.authorAccountId !== accountId) throw forbidden('That post is not yours.');
  await db().collection(Collections.posts).doc(postId).delete();
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

export async function addComment(
  accountId: string,
  postId: string,
  input: CreateCommentInput,
): Promise<PostComment> {
  const post = await getPost(postId);
  if (!post) throw notFound('That post');

  const { author } = await buildAuthor(accountId, false);
  const ts = nowIso();

  const comment: Omit<PostComment, 'id'> = {
    postId,
    author,
    authorAccountId: accountId,
    body: input.body,
    createdAt: ts,
  };

  const ref = await db()
    .collection(Collections.posts)
    .doc(postId)
    .collection(Collections.comments)
    .add(comment);

  await db()
    .collection(Collections.posts)
    .doc(postId)
    .update({ commentCount: FieldValue.increment(1), updatedAt: ts });

  if (post.authorAccountId !== accountId) {
    void emit({
      accountId: post.authorAccountId,
      type: 'post_comment',
      payload: { postId, commentId: ref.id, byAccountId: accountId },
    });
  }

  return { id: ref.id, ...comment };
}

export async function listComments(postId: string, limit: number): Promise<PostComment[]> {
  const snap = await db()
    .collection(Collections.posts)
    .doc(postId)
    .collection(Collections.comments)
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();

  return snap.docs.map((d) => serialise<PostComment>({ id: d.id, ...d.data() }));
}
