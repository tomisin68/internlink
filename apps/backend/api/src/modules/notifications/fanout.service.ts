import type { Account, Post } from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { serialise } from '../../lib/firestore.js';
import { logger } from '../../lib/logger.js';
import { emitMany } from './events.js';
import { sendToAccounts } from './push.service.js';

/**
 * FR-601 — "someone you follow posted".
 *
 * This is fan-out on *notify*, which is a different decision from the feed's
 * fan-out on read. The feed can afford to rank lazily because nobody is waiting
 * on a notification that has not happened yet; a push has to be addressed to
 * specific devices, so the follower list has to be walked at some point either
 * way.
 *
 * It runs detached from the request that created the post. The author should
 * not wait on their followers' devices, and a push failure must never fail a
 * publish.
 */

/** Beyond this, one post's fan-out stops being reasonable inline work. */
const MAX_FOLLOWERS_PER_POST = 500;

/** Everyone following this account or the company it posted as. */
async function audienceFor(post: Post): Promise<string[]> {
  const targetIds = [post.authorAccountId];
  if (post.companyId) targetIds.push(post.companyId);

  const snaps = await Promise.all(
    targetIds.map((targetId) =>
      db()
        .collection(Collections.follows)
        .where('targetId', '==', targetId)
        .limit(MAX_FOLLOWERS_PER_POST)
        .get(),
    ),
  );

  const followers = new Set<string>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const followerId = doc.data().followerId as string | undefined;
      // Never notify someone about their own post — posting as a company you
      // follow would otherwise ping you about your own announcement.
      if (followerId && followerId !== post.authorAccountId) followers.add(followerId);
    }
  }

  return [...followers];
}

function previewOf(post: Post): string {
  const text = post.body.trim();
  if (text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;

  // A photo-only post has no caption to quote, so describe it instead of
  // sending an empty notification body.
  const media = post.media ?? [];
  const hasVideo = media.some((item) => item.kind === 'video');
  if (hasVideo) return 'Shared a video';
  if (media.length > 1) return `Shared ${media.length} photos`;
  if (media.length === 1) return 'Shared a photo';
  return 'Shared an update';
}

/**
 * Notifies followers that a post went up. Never throws.
 *
 * Writes the durable notification for every follower and pushes to whichever of
 * them have a registered device — the in-app bell must work whether or not
 * anyone granted push permission.
 */
export async function notifyFollowersOfPost(post: Post): Promise<void> {
  try {
    const followers = await audienceFor(post);
    if (followers.length === 0) return;

    const preview = previewOf(post);
    const firstImage = (post.media ?? []).find((item) => item.kind === 'image');
    const poster = (post.media ?? []).find((item) => item.thumbnailUrl);

    await emitMany(followers, {
      type: 'new_post_from_following',
      payload: { postId: post.id, byAccountId: post.authorAccountId },
    });

    await sendToAccounts(followers, {
      title: `${post.author.name} posted`,
      body: preview,
      path: `/p/${post.id}`,
      imageUrl: firstImage?.url ?? poster?.thumbnailUrl ?? null,
      // One notification per post, so a device that reconnects after a gap does
      // not stack five separate toasts for the same author.
      tag: `post:${post.id}`,
    });
  } catch (error) {
    logger.error({ err: error, postId: post.id }, 'Follower fan-out failed — post still published');
  }
}

/* ======================================================== re-engagement === */

/**
 * FR-604 — the "you have missed this" nudge.
 *
 * Deliberately conservative. A re-engagement push is the single easiest way to
 * get an app's notifications switched off for good, so this only fires when
 * there is something real to come back to, only once per quiet spell, and never
 * for an account that has not finished onboarding — nagging someone about a feed
 * they have never seen is not re-engagement, it is noise.
 */
export interface ReengagementResult {
  scanned: number;
  notified: number;
  pushesSent: number;
}

export async function runReengagementSweep(options: {
  inactiveDays: number;
  limit: number;
  now?: Date;
}): Promise<ReengagementResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.inactiveDays * 86_400_000).toISOString();
  // A second, longer window stops the same person being nudged every night once
  // they cross the inactivity line and stay there.
  const nudgeCooldown = new Date(now.getTime() - 14 * 86_400_000).toISOString();

  const snap = await db()
    .collection(Collections.accounts)
    .where('lastActiveAt', '<', cutoff)
    .orderBy('lastActiveAt', 'asc')
    .limit(options.limit)
    .get();

  const candidates = snap.docs
    .map((doc) => serialise<Account & { lastNudgedAt?: string | null }>({ id: doc.id, ...doc.data() }))
    .filter(
      (account) =>
        account.status === 'active' &&
        Boolean(account.onboardingCompletedAt) &&
        (!account.lastNudgedAt || account.lastNudgedAt < nudgeCooldown),
    );

  if (candidates.length === 0) {
    return { scanned: snap.size, notified: 0, pushesSent: 0 };
  }

  const ids = candidates.map((a) => a.id);

  await emitMany(ids, {
    type: 'reengagement',
    payload: { inactiveDays: options.inactiveDays },
  });

  const { sent } = await sendToAccounts(ids, {
    title: 'You have missed a few things',
    body: 'New roles and updates from your network are waiting.',
    path: '/feed',
    tag: 'reengagement',
  });

  // Stamping this is what makes the cooldown work, so it is written even when
  // the push itself failed — a nudge that did not arrive should not license a
  // second attempt tomorrow night.
  const batch = db().batch();
  for (const id of ids) {
    batch.update(db().collection(Collections.accounts).doc(id), { lastNudgedAt: now.toISOString() });
  }
  await batch.commit();

  return { scanned: snap.size, notified: ids.length, pushesSent: sent };
}
