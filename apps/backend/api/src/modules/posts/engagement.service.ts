import {
  MAX_MENTIONS,
  REACTOR_PREVIEW_SIZE,
  extractMentions,
  type Account,
  type Mention,
  type PostReactor,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { nowIso, serialise } from '../../lib/firestore.js';
import { notFound } from '../../lib/errors.js';
import { connectedIds, followedIds } from '../connections/connections.service.js';

/**
 * The engagement side of a post: saves, who reacted, and who was tagged.
 *
 * Split out of `posts.service.ts` because none of it is about authoring. These
 * are all read-shaped concerns that several callers need — the feed, the
 * permalink, the profile tab — and keeping them here stops each of those
 * growing its own slightly different version.
 */

/* ============================================================= bookmarks == */

/**
 * FR-1007 — saving a post.
 *
 * Deterministic document ID, the same shape reactions use, for the same reason:
 * a double-tap on a flaky connection must not be able to leave two rows behind,
 * and un-saving must not depend on having found the right one.
 */
function bookmarkId(postId: string, accountId: string): string {
  return `${postId}__${accountId}`;
}

export async function toggleBookmark(
  accountId: string,
  postId: string,
): Promise<{ isBookmarked: boolean }> {
  const post = await db().collection(Collections.posts).doc(postId).get();
  if (!post.exists) throw notFound('That post');

  const ref = db().collection(Collections.postBookmarks).doc(bookmarkId(postId, accountId));
  const existing = await ref.get();

  if (existing.exists) {
    await ref.delete();
    return { isBookmarked: false };
  }

  await ref.set({ postId, accountId, createdAt: nowIso() });
  return { isBookmarked: true };
}

export async function setBookmark(
  accountId: string,
  postId: string,
  saved: boolean,
): Promise<{ isBookmarked: boolean }> {
  const ref = db().collection(Collections.postBookmarks).doc(bookmarkId(postId, accountId));

  if (!saved) {
    await ref.delete();
    return { isBookmarked: false };
  }

  const post = await db().collection(Collections.posts).doc(postId).get();
  if (!post.exists) throw notFound('That post');

  await ref.set({ postId, accountId, createdAt: nowIso() });
  return { isBookmarked: true };
}

export async function isBookmarked(accountId: string, postId: string): Promise<boolean> {
  const snap = await db()
    .collection(Collections.postBookmarks)
    .doc(bookmarkId(postId, accountId))
    .get();
  return snap.exists;
}

/**
 * Every post this account has saved, newest first.
 *
 * Capped rather than paginated: a saved list is a shortlist. Past a couple of
 * hundred it wants a proper cursor, and the signal to build one is people
 * actually hitting this ceiling.
 */
export async function bookmarkedPostIds(accountId: string, limit = 200): Promise<string[]> {
  const snap = await db()
    .collection(Collections.postBookmarks)
    .where('accountId', '==', accountId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((d) => d.data().postId as string);
}

/** The viewer's saved set, for marking up a page of posts in one read. */
export async function bookmarkedSet(accountId: string, limit = 500): Promise<Set<string>> {
  const snap = await db()
    .collection(Collections.postBookmarks)
    .where('accountId', '==', accountId)
    .limit(limit)
    .get();
  return new Set(snap.docs.map((d) => d.data().postId as string));
}

/* ============================================================== reactors == */

/**
 * A sample of who reacted to each of these posts.
 *
 * One query per ten posts rather than one per post. The chunk is deliberately
 * small: without an `orderBy` Firestore returns documents in ID order, and
 * reaction IDs start with the post ID, so a large chunk with a shared limit
 * would spend its whole budget on whichever post sorts first and return nothing
 * for the rest.
 *
 * The sample is not "the first three people to like this" in any meaningful
 * order, and it is not trying to be — the line it feeds says "Liked by Ada and
 * 24 others", where the 24 comes from the post's own counter and is exact. What
 * the sample has to get right is showing a face the viewer might recognise,
 * which is why people the viewer knows are pulled to the front.
 */
export async function sampleReactors(
  postIds: string[],
  viewerId: string,
): Promise<Map<string, PostReactor[]>> {
  const byPost = new Map<string, PostReactor[]>();
  if (postIds.length === 0) return byPost;

  const chunks: string[][] = [];
  for (let i = 0; i < postIds.length; i += 10) chunks.push(postIds.slice(i, i + 10));

  const [snaps, known] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        db()
          .collection(Collections.postReactions)
          .where('postId', 'in', chunk)
          .limit(chunk.length * 12)
          .get(),
      ),
    ),
    knownAccountIds(viewerId),
  ]);

  const rawByPost = new Map<string, string[]>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const data = doc.data() as { postId?: string; accountId?: string };
      if (!data.postId || !data.accountId) continue;
      const list = rawByPost.get(data.postId) ?? [];
      list.push(data.accountId);
      rawByPost.set(data.postId, list);
    }
  }

  // People the viewer knows first, then everyone else. "Liked by three people
  // you have never heard of" is not social proof; "Liked by Ada" is.
  const chosen = new Set<string>();
  for (const [postId, accountIds] of rawByPost) {
    const ordered = [
      ...accountIds.filter((id) => known.has(id)),
      ...accountIds.filter((id) => !known.has(id)),
    ].slice(0, REACTOR_PREVIEW_SIZE);
    rawByPost.set(postId, ordered);
    for (const id of ordered) chosen.add(id);
  }

  const people = await loadReactors([...chosen]);

  for (const [postId, accountIds] of rawByPost) {
    byPost.set(
      postId,
      accountIds.map((id) => people.get(id)).filter((p): p is PostReactor => Boolean(p)),
    );
  }

  return byPost;
}

/** Connections and follows — who the viewer would actually recognise. */
async function knownAccountIds(viewerId: string): Promise<Set<string>> {
  const [connections, follows] = await Promise.all([
    connectedIds(viewerId).catch(() => [] as string[]),
    followedIds(viewerId).catch(() => ({ accounts: new Set<string>(), companies: new Set<string>() })),
  ]);
  return new Set([...connections, ...follows.accounts]);
}

async function loadReactors(accountIds: string[]): Promise<Map<string, PostReactor>> {
  const people = new Map<string, PostReactor>();
  if (accountIds.length === 0) return people;

  const chunks: string[][] = [];
  for (let i = 0; i < accountIds.length; i += 30) chunks.push(accountIds.slice(i, i + 30));

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      db().collection(Collections.accounts).where('__name__', 'in', chunk).get(),
    ),
  );

  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const account = serialise<Account>({ id: doc.id, ...doc.data() });
      people.set(account.id, {
        id: account.id,
        displayName: account.displayName || `${account.firstName} ${account.lastName}`.trim(),
        photoUrl: account.photoUrl ?? null,
      });
    }
  }

  return people;
}

/** The full reactor list for one post — what the "Liked by" sheet opens to. */
export async function listReactors(postId: string, limit = 60): Promise<PostReactor[]> {
  const snap = await db()
    .collection(Collections.postReactions)
    .where('postId', '==', postId)
    .limit(limit)
    .get();

  const ids = snap.docs
    .map((d) => d.data().accountId as string | undefined)
    .filter((id): id is string => Boolean(id));

  const people = await loadReactors(ids);
  return ids.map((id) => people.get(id)).filter((p): p is PostReactor => Boolean(p));
}

/* =============================================================== mentions = */

/**
 * Resolves `@name` runs in a body against people the author can actually reach.
 *
 * The client's mention list is never trusted: it arrives as a hint and is
 * thrown away. Deriving the answer here from the body text against a bounded
 * candidate set is what stops a crafted request from tagging — and notifying —
 * anyone on the platform.
 *
 * The candidate set is the author's connections and follows. That is a real
 * limitation: you cannot tag a stranger. It is also the right default, because
 * "anyone can tag anyone" is how mentions become a spam vector, and the people
 * someone actually wants to tag are overwhelmingly people they already know.
 */
export async function resolveMentions(authorId: string, body: string): Promise<Mention[]> {
  if (!body.includes('@')) return [];

  const candidateIds = [...(await knownAccountIds(authorId))].slice(0, 300);
  if (candidateIds.length === 0) return [];

  const accounts = await loadReactors(candidateIds);
  const candidates = [...accounts.values()].map((person) => ({
    accountId: person.id,
    displayName: person.displayName,
  }));

  return extractMentions(body, candidates).slice(0, MAX_MENTIONS);
}

/** People the composer offers while typing `@`. */
export async function mentionCandidates(
  accountId: string,
  term: string,
  limit = 8,
): Promise<PostReactor[]> {
  const ids = [...(await knownAccountIds(accountId))].slice(0, 300);
  const people = [...(await loadReactors(ids)).values()];

  const needle = term.trim().toLowerCase();
  const matched = needle
    ? people.filter((person) => person.displayName.toLowerCase().includes(needle))
    : people;

  // Prefix matches first — typing "ad" should surface Ada before Fadeke.
  matched.sort((a, b) => {
    const aStarts = a.displayName.toLowerCase().startsWith(needle) ? 0 : 1;
    const bStarts = b.displayName.toLowerCase().startsWith(needle) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.displayName.localeCompare(b.displayName);
  });

  return matched.slice(0, limit);
}
