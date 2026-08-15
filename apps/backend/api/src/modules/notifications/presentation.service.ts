import type {
  Account,
  Listing,
  NotificationActor,
  NotificationTarget,
  NotificationView,
  Post,
  PostComment,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { serialise } from '../../lib/firestore.js';
import { logger } from '../../lib/logger.js';

/**
 * Turns stored notification events into something a person can read.
 *
 * `events.ts` writes the smallest durable record it can — a type, an account,
 * and a bag of IDs. That is the right shape to *store*: it never goes stale,
 * and it does not duplicate data that lives elsewhere. It is the wrong shape to
 * *render*, which is why the first version of the notifications screen said
 * "Someone reacted to your post" for everything.
 *
 * Resolution happens here, on read, in batches across the whole page. Doing it
 * at write time would mean a notification carrying a name that is wrong the
 * moment someone changes it, and doing it in the client would mean a profile
 * fetch per row.
 */

interface RawNotification {
  id: string;
  accountId: string;
  type: string;
  payload: Record<string, unknown>;
  urgent: boolean;
  readAt: string | null;
  createdAt: string;
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Whichever payload key this event type uses for "the person who did it". */
function actorIdOf(payload: Record<string, unknown>): string | null {
  return (
    stringField(payload, 'byAccountId') ??
    stringField(payload, 'fromAccountId') ??
    stringField(payload, 'senderId') ??
    null
  );
}

async function loadByIds<T>(
  collection: string,
  ids: string[],
  map: (id: string, data: Record<string, unknown>) => T,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (ids.length === 0) return out;

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      db()
        .collection(collection)
        .where('__name__', 'in', chunk)
        .get()
        .catch(() => null),
    ),
  );

  for (const snap of snaps) {
    for (const doc of snap?.docs ?? []) out.set(doc.id, map(doc.id, doc.data()));
  }

  return out;
}

/** The opening words of a post, or a description of what it holds. */
function previewOfPost(post: Post): string {
  const body = post.body?.trim();
  if (body) return body.length > 160 ? `${body.slice(0, 157)}…` : body;

  const media = post.media ?? [];
  if (media.some((item) => item.kind === 'video')) return 'a video';
  if (media.length > 1) return `${media.length} photos`;
  if (media.length === 1) return 'a photo';
  return 'a post';
}

/**
 * Resolves actors and targets for a page of notifications.
 *
 * Four batched reads at most, regardless of page size: accounts, posts,
 * comments and listings. Comments are the awkward one — they live in a
 * subcollection under their post, so they cannot be fetched by ID alone and are
 * read individually. That is bounded by the number of comment notifications on
 * one page, which is small, and the preview is the whole reason those
 * notifications are worth opening.
 */
export async function enrichNotifications(
  records: RawNotification[],
): Promise<NotificationView[]> {
  if (records.length === 0) return [];

  const actorIds = [
    ...new Set(records.map((r) => actorIdOf(r.payload)).filter((id): id is string => Boolean(id))),
  ];
  const postIds = [
    ...new Set(
      records.map((r) => stringField(r.payload, 'postId')).filter((id): id is string => Boolean(id)),
    ),
  ];
  const listingIds = [
    ...new Set(
      records
        .map((r) => stringField(r.payload, 'listingId'))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const commentRefs = records
    .map((r) => ({
      postId: stringField(r.payload, 'postId'),
      commentId: stringField(r.payload, 'commentId'),
    }))
    .filter((ref): ref is { postId: string; commentId: string } =>
      Boolean(ref.postId && ref.commentId),
    );

  const [accounts, posts, listings, comments] = await Promise.all([
    loadByIds(Collections.accounts, actorIds, (id, data) => serialise<Account>({ id, ...data })),
    loadByIds(Collections.posts, postIds, (id, data) => serialise<Post>({ id, ...data })),
    loadByIds(Collections.listings, listingIds, (id, data) => serialise<Listing>({ id, ...data })),
    loadComments(commentRefs),
  ]);

  const actorOf = (payload: Record<string, unknown>): NotificationActor | null => {
    const id = actorIdOf(payload);
    if (!id) return null;
    const account = accounts.get(id);
    if (!account) return null;
    return {
      id: account.id,
      displayName: account.displayName || `${account.firstName} ${account.lastName}`.trim(),
      photoUrl: account.photoUrl ?? null,
      headline: null,
    };
  };

  return records.map((record) => ({
    id: record.id,
    type: record.type,
    payload: record.payload,
    urgent: record.urgent,
    readAt: record.readAt,
    createdAt: record.createdAt,
    actor: actorOf(record.payload),
    target: targetFor(record, { posts, listings, comments }),
  }));
}

async function loadComments(
  refs: Array<{ postId: string; commentId: string }>,
): Promise<Map<string, PostComment>> {
  const out = new Map<string, PostComment>();
  if (refs.length === 0) return out;

  const unique = new Map(refs.map((ref) => [`${ref.postId}/${ref.commentId}`, ref]));

  await Promise.all(
    [...unique.values()].map(async (ref) => {
      try {
        const snap = await db()
          .collection(Collections.posts)
          .doc(ref.postId)
          .collection(Collections.comments)
          .doc(ref.commentId)
          .get();
        if (snap.exists) {
          out.set(ref.commentId, serialise<PostComment>({ id: snap.id, ...snap.data() }));
        }
      } catch (error) {
        // A missing preview is a worse notification, not a broken page.
        logger.debug({ err: error, ...ref }, 'Comment preview not resolved');
      }
    }),
  );

  return out;
}

function targetFor(
  record: RawNotification,
  data: {
    posts: Map<string, Post>;
    listings: Map<string, Listing>;
    comments: Map<string, PostComment>;
  },
): NotificationTarget | null {
  const commentId = stringField(record.payload, 'commentId');
  const postId = stringField(record.payload, 'postId');
  const listingId = stringField(record.payload, 'listingId');
  const threadId = stringField(record.payload, 'threadId');

  if (commentId) {
    const comment = data.comments.get(commentId);
    // `preview` on the payload is written at emit time and survives the comment
    // being deleted, so it is the better fallback than the post's body.
    const preview = comment?.body ?? stringField(record.payload, 'preview') ?? '';
    return {
      kind: 'comment',
      id: commentId,
      preview: preview.slice(0, 240),
      mediaUrl: null,
    };
  }

  if (postId) {
    const post = data.posts.get(postId);
    return {
      kind: 'post',
      id: postId,
      preview: post ? previewOfPost(post) : (stringField(record.payload, 'preview') ?? ''),
      mediaUrl:
        post?.media?.find((item) => item.kind === 'image')?.url ??
        post?.media?.[0]?.thumbnailUrl ??
        post?.mediaUrl ??
        null,
    };
  }

  if (listingId) {
    const listing = data.listings.get(listingId);
    return {
      kind: 'listing',
      id: listingId,
      preview: listing?.title ?? '',
      mediaUrl: null,
    };
  }

  if (threadId) {
    return {
      kind: 'thread',
      id: threadId,
      preview: (stringField(record.payload, 'preview') ?? '').slice(0, 240),
      mediaUrl: null,
    };
  }

  return null;
}
