import type { PushTokenInput } from '@internlink/shared-types';
import { Collections, db, firebaseMessaging } from '../../config/firebase.js';
import { env } from '../../config/env.js';
import { nowIso } from '../../lib/firestore.js';
import { logger } from '../../lib/logger.js';

/**
 * FR-601/604 — web push delivery over Firebase Cloud Messaging.
 *
 * The Admin SDK signs sends with the service account, so there is no private
 * push key here. The only extra configuration is the PUBLIC half of the VAPID
 * pair, which the browser needs when it asks for a token.
 *
 * Nothing in this file throws into a caller. A push that fails must never take
 * down the action that triggered it — a post that publishes but does not notify
 * is a far better outcome than a post that refuses to publish because FCM is
 * having a bad afternoon.
 */

/**
 * Fan-out ceiling for a single inline send.
 *
 * Notifying followers happens on the request that created the post, so this is
 * bounded by what is acceptable to do while someone waits. Past this the job
 * belongs on a queue — the signal to build one is accounts routinely exceeding
 * it, not the number itself getting inconvenient.
 */
const MAX_INLINE_FANOUT = 500;

/** FCM refuses more than 500 tokens per multicast. */
const FCM_BATCH_SIZE = 500;

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap should land. Relative to the web origin. */
  path: string;
  imageUrl?: string | null;
  /** Collapses same-subject notifications instead of stacking them. */
  tag?: string;
  /**
   * Delivery priority, as the Web Push `Urgency` header.
   *
   * This is not a nicety. A phone on a metered or dozing connection defers
   * `normal` traffic — on iOS that can mean a message notification arriving
   * with the next wake-up rather than now, which for a chat is the same as not
   * arriving. `high` is for the handful of events a person is actually waiting
   * on; everything else stays `normal` so it does not compete with them.
   */
  urgency?: 'normal' | 'high';
  /**
   * How long the push service should hold this if the device is offline.
   *
   * Defaults to a day: "someone liked your post" is worthless by then. A direct
   * message is not, so those ask for longer.
   */
  ttlSeconds?: number;
}

/** A day. Long enough to survive a night with the phone off, short enough to stay relevant. */
const DEFAULT_TTL_SECONDS = 86_400;

export async function registerToken(accountId: string, input: PushTokenInput): Promise<void> {
  // Keyed by the token, not by account: the same browser re-registering must
  // update one document rather than accumulate a row per sign-in. It also means
  // a token that moves to a different account (shared laptop) is reassigned
  // rather than duplicated, so the previous owner stops receiving it.
  const ref = db().collection(Collections.pushTokens).doc(hashToken(input.token));

  // A transaction rather than a plain `set`, now that the client re-registers on
  // every foreground: a blind overwrite would reset `createdAt` on each one, and
  // "when did this device first turn notifications on" is the field you want
  // when a user reports they stopped arriving.
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();

    tx.set(
      ref,
      {
        accountId,
        token: input.token,
        platform: input.platform,
        userAgent: input.userAgent ?? null,
        createdAt: snap.exists ? (snap.data()?.createdAt ?? now) : now,
        lastSeenAt: now,
      },
      { merge: true },
    );
  });
}

export async function unregisterToken(token: string): Promise<void> {
  await db().collection(Collections.pushTokens).doc(hashToken(token)).delete();
}

/**
 * Firestore document IDs cannot contain `/`, and FCM tokens routinely do.
 *
 * A plain hash keeps the ID deterministic — which is what makes re-registration
 * idempotent — without needing to escape anything.
 */
function hashToken(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (Math.imul(31, hash) + token.charCodeAt(i)) | 0;
  }
  // Length is included so two different tokens colliding on the numeric hash
  // still need the same length to collide as IDs.
  return `t_${(hash >>> 0).toString(36)}_${token.length}_${token.slice(-12).replace(/[^a-zA-Z0-9]/g, '')}`;
}

async function tokensFor(accountIds: string[]): Promise<Map<string, string[]>> {
  const byAccount = new Map<string, string[]>();
  if (accountIds.length === 0) return byAccount;

  const chunks: string[][] = [];
  for (let i = 0; i < accountIds.length; i += 30) chunks.push(accountIds.slice(i, i + 30));

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      db().collection(Collections.pushTokens).where('accountId', 'in', chunk).get(),
    ),
  );

  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const data = doc.data() as { accountId: string; token: string };
      const list = byAccount.get(data.accountId) ?? [];
      list.push(data.token);
      byAccount.set(data.accountId, list);
    }
  }

  return byAccount;
}

/**
 * Sends to every device registered to these accounts.
 *
 * Returns how many messages landed, mostly so the scheduled jobs have something
 * honest to log. Dead tokens are pruned as they are discovered: FCM tells us
 * exactly which registrations are gone, and leaving them in place means every
 * future send does measurable work for a device that no longer exists.
 */
export async function sendToAccounts(
  accountIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (accountIds.length === 0) return { sent: 0, pruned: 0 };

  try {
    const byAccount = await tokensFor(accountIds.slice(0, MAX_INLINE_FANOUT));
    const tokens = [...byAccount.values()].flat();
    if (tokens.length === 0) return { sent: 0, pruned: 0 };

    let sent = 0;
    const dead: string[] = [];

    for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
      const batch = tokens.slice(i, i + FCM_BATCH_SIZE);

      const response = await firebaseMessaging().sendEachForMulticast({
        tokens: batch,
        // `data` only, no `notification` block: with a notification payload the
        // browser renders its own toast AND fires onBackgroundMessage, so the
        // user gets two. Letting the service worker own the display keeps it to
        // one and lets us control the icon, tag and click target.
        data: {
          title: payload.title,
          body: payload.body,
          path: payload.path,
          tag: payload.tag ?? '',
          imageUrl: payload.imageUrl ?? '',
        },
        webpush: {
          fcmOptions: { link: `${env.WEB_APP_ORIGIN}${payload.path}` },
          headers: {
            TTL: String(payload.ttlSeconds ?? DEFAULT_TTL_SECONDS),
            Urgency: payload.urgency ?? 'normal',
          },
        },
      });

      sent += response.successCount;

      response.responses.forEach((result, index) => {
        const code = result.error?.code ?? '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          const token = batch[index];
          if (token) dead.push(token);
        }
      });
    }

    await Promise.all(dead.map((token) => unregisterToken(token).catch(() => undefined)));

    return { sent, pruned: dead.length };
  } catch (error) {
    logger.error({ err: error, count: accountIds.length }, 'Push send failed — action still succeeded');
    return { sent: 0, pruned: 0 };
  }
}
