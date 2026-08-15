import type { Account } from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { nowIso, serialise } from '../../lib/firestore.js';
import { logger } from '../../lib/logger.js';
import { digestEmail, sendEmail, urgentEmail, type DigestEntry } from './email.service.js';
import type { NotificationType } from './events.js';

/**
 * FR-603/604 — the consumer `events.ts` has always been writing for.
 *
 * Every emitted notification lands in Firestore with a `deliveryState` of
 * `pending_batch` or `pending_immediate`. Nothing read them until now. This is
 * that reader: it claims pending rows, sends what they warrant, and marks them
 * delivered.
 *
 * Runs from the scheduled-job endpoint rather than a Firestore trigger, for the
 * same reason the re-engagement sweep does: the API is already deployed and
 * Cloud Functions are not, and a cron hitting an endpoint is one moving part
 * instead of three.
 */

interface NotificationRow {
  id: string;
  accountId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  urgent: boolean;
  suppressPush: boolean;
  deliveryState: string;
  channelsSent: string[];
  createdAt: string;
}

/** How each event reads in an email. Unknown types are skipped, not guessed at. */
const COPY: Partial<
  Record<NotificationType, { title: string; detail: string; path: (p: Record<string, unknown>) => string; cta: string }>
> = {
  message_received: {
    title: 'New message',
    detail: 'Someone sent you a message.',
    path: (p) => (p.threadId ? `/messages/${p.threadId as string}` : '/messages'),
    cta: 'Read it',
  },
  message_request: {
    title: 'New message request',
    detail: 'Someone outside your network wants to reach you.',
    path: () => '/messages',
    cta: 'Review it',
  },
  connection_request: {
    title: 'Connection request',
    detail: 'Someone wants to connect with you.',
    path: () => '/network',
    cta: 'See the request',
  },
  connection_accepted: {
    title: 'Connection accepted',
    detail: 'You are now connected.',
    path: () => '/network',
    cta: 'Say hello',
  },
  application_status_changed: {
    title: 'An application moved forward',
    detail: 'One of your applications has changed status.',
    path: () => '/applications',
    cta: 'See where it stands',
  },
  application_received: {
    title: 'New applicant',
    detail: 'Someone applied to one of your roles.',
    path: (p) => (p.listingId ? `/roles/${p.listingId as string}/pipeline` : '/roles'),
    cta: 'Review the applicant',
  },
  interview_scheduled: {
    title: 'Interview scheduled',
    detail: 'An interview has been set up with you.',
    path: () => '/applications',
    cta: 'See the details',
  },
  company_verified: {
    title: 'Your company is verified',
    detail: 'You can now publish roles.',
    path: () => '/roles',
    cta: 'Post a role',
  },
  new_post_from_following: {
    title: 'Someone you follow posted',
    detail: 'There is a new post in your feed.',
    path: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
    cta: 'Read it',
  },
  post_comment: {
    title: 'New comment on your post',
    detail: 'Someone replied to something you shared.',
    path: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
    cta: 'See the comment',
  },
  post_reaction: {
    title: 'Someone reacted to your post',
    detail: 'Your post is getting attention.',
    path: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
    cta: 'See the post',
  },
  post_reshare: {
    title: 'Someone reshared your post',
    detail: 'Your post reached a new audience.',
    path: (p) => (p.postId ? `/p/${p.postId as string}` : '/feed'),
    cta: 'See the post',
  },
  listing_match: {
    title: 'A new role matches you',
    detail: 'A role was posted that fits your profile.',
    path: () => '/matches',
    cta: 'See the match',
  },
};

export interface DigestResult {
  claimed: number;
  emailsSent: number;
  accounts: number;
  skipped: number;
}

/**
 * Sends what is pending and marks it delivered.
 *
 * Batched events are grouped per account into one email — a network that emails
 * on every reaction gets filtered to spam within a week, and then the messages
 * that actually matter go with it. Urgent events are sent individually because
 * batching them defeats the point of marking them urgent.
 *
 * Rows are marked delivered whether or not the send succeeded. Retrying a
 * failed email on the next run sounds right and is not: a persistently failing
 * address would be retried forever, and the notification is already visible
 * in-app regardless.
 */
export async function runDigest(options: {
  limit: number;
  now?: Date;
}): Promise<DigestResult> {
  const now = options.now ?? new Date();

  const [batchSnap, urgentSnap] = await Promise.all([
    claim('pending_batch', options.limit),
    claim('pending_immediate', Math.min(options.limit, 100)),
  ]);

  const rows = [...batchSnap, ...urgentSnap];
  if (rows.length === 0) return { claimed: 0, emailsSent: 0, accounts: 0, skipped: 0 };

  const accountIds = [...new Set(rows.map((row) => row.accountId))];
  const accounts = await loadAccounts(accountIds);

  let emailsSent = 0;
  let skipped = 0;

  // Urgent first — these are the ones with a deadline attached.
  for (const row of urgentSnap) {
    const account = accounts.get(row.accountId);
    const copy = COPY[row.type];
    if (!account || !copy || !account.email) {
      skipped += 1;
      continue;
    }

    const ok = await sendEmail(
      urgentEmail({
        to: account.email,
        firstName: account.firstName || 'there',
        heading: copy.title,
        detail: copy.detail,
        path: copy.path(row.payload),
        ctaLabel: copy.cta,
      }),
    );
    if (ok) emailsSent += 1;
    else skipped += 1;
  }

  // Then one digest per account for everything batchable.
  const byAccount = new Map<string, NotificationRow[]>();
  for (const row of batchSnap) {
    byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  }

  for (const [accountId, group] of byAccount) {
    const account = accounts.get(accountId);
    if (!account?.email) {
      skipped += group.length;
      continue;
    }

    const entries: DigestEntry[] = group
      .map((row) => {
        const copy = COPY[row.type];
        return copy ? { title: copy.title, detail: copy.detail, path: copy.path(row.payload) } : null;
      })
      .filter((entry): entry is DigestEntry => entry !== null);

    if (entries.length === 0) {
      skipped += group.length;
      continue;
    }

    const ok = await sendEmail(
      digestEmail({
        to: account.email,
        firstName: account.firstName || 'there',
        entries,
      }),
    );
    if (ok) emailsSent += 1;
  }

  await markDelivered(rows, now.toISOString());

  const result: DigestResult = {
    claimed: rows.length,
    emailsSent,
    accounts: accountIds.length,
    skipped,
  };
  logger.info(result, 'Notification digest run complete');
  return result;
}

async function claim(state: string, limit: number): Promise<NotificationRow[]> {
  const snap = await db()
    .collection(Collections.notifications)
    .where('deliveryState', '==', state)
    .orderBy('createdAt', 'asc')
    .limit(limit)
    .get();

  return snap.docs.map((d) => serialise<NotificationRow>({ id: d.id, ...d.data() }));
}

async function loadAccounts(ids: string[]): Promise<Map<string, Account>> {
  const accounts = new Map<string, Account>();

  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snap = await db().collection(Collections.accounts).where('__name__', 'in', chunk).get();
    for (const doc of snap.docs) {
      const account = serialise<Account>({ id: doc.id, ...doc.data() });
      // Never mail a suspended or banned account — the whole point of the state
      // is that we have stopped talking to them.
      if (account.status === 'active' || account.status === 'restricted') {
        accounts.set(account.id, account);
      }
    }
  }

  return accounts;
}

async function markDelivered(rows: NotificationRow[], deliveredAt: string): Promise<void> {
  // Firestore caps a batch at 500 writes.
  for (let i = 0; i < rows.length; i += 500) {
    const batch = db().batch();
    for (const row of rows.slice(i, i + 500)) {
      batch.update(db().collection(Collections.notifications).doc(row.id), {
        deliveryState: 'delivered',
        channelsSent: [...new Set([...(row.channelsSent ?? []), 'email'])],
        deliveredAt,
      });
    }
    await batch.commit();
  }
}
