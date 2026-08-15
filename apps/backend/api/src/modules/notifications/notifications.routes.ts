import { Router } from 'express';
import { z } from 'zod';
import {
  PushTokenSchema,
  type PushCapabilities,
  type PushTokenInput,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendOk } from '../../lib/respond.js';
import { forbidden, notFound, unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { Collections, db } from '../../config/firebase.js';
import { env, hasPushCredentials } from '../../config/env.js';
import { nowIso, serialise } from '../../lib/firestore.js';
import { logger } from '../../lib/logger.js';
import * as push from './push.service.js';
import { runReengagementSweep } from './fanout.service.js';
import type { NotificationType } from './events.js';

export const notificationsRouter = Router();

/* ======================================================= scheduled jobs === */

/**
 * The re-engagement sweep, mounted BEFORE `requireAuth`.
 *
 * A cron caller has no user session, so it authenticates with a shared secret
 * instead. If `CRON_SECRET` is unset the route refuses everything rather than
 * falling open — an unauthenticated "notify every dormant user" endpoint is a
 * spam cannon aimed at your own install base.
 */
const ReengagementBody = z.object({
  inactiveDays: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(400).default(200),
});

notificationsRouter.post(
  '/jobs/reengagement',
  validate(ReengagementBody),
  asyncHandler(async (req, res) => {
    const provided = req.header('x-cron-secret');
    if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
      throw forbidden('This endpoint is not available.');
    }

    const { inactiveDays, limit } = req.body as z.infer<typeof ReengagementBody>;
    const result = await runReengagementSweep({ inactiveDays, limit });

    logger.info(result, 'Re-engagement sweep complete');
    sendOk(res, result);
  }),
);

notificationsRouter.use(requireAuth);

/* ============================================================= web push === */

/** Whether push can work here at all — see the uploads/status precedent. */
notificationsRouter.get(
  '/push/status',
  asyncHandler(async (_req, res) => {
    const payload: PushCapabilities = {
      available: hasPushCredentials,
      vapidKey: hasPushCredentials ? env.FIREBASE_VAPID_KEY! : null,
    };
    sendOk(res, payload);
  }),
);

notificationsRouter.post(
  '/push/tokens',
  validate(PushTokenSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await push.registerToken(req.auth.accountId, req.body as PushTokenInput);
    sendOk(res, { registered: true });
  }),
);

notificationsRouter.delete(
  '/push/tokens',
  validate(z.object({ token: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await push.unregisterToken((req.body as { token: string }).token);
    sendOk(res, { registered: false });
  }),
);

/** Fires a push to your own devices, so setup can be verified end to end. */
notificationsRouter.post(
  '/push/test',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const result = await push.sendToAccounts([req.auth.accountId], {
      title: 'Notifications are on',
      body: 'This is what a notification from InternLink looks like.',
      path: '/notifications',
      tag: 'push-test',
    });
    sendOk(res, result);
  }),
);

export interface NotificationRecord {
  id: string;
  accountId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  urgent: boolean;
  deliveryState: string;
  readAt: string | null;
  createdAt: string;
}

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  unreadOnly: z.coerce.boolean().default(false),
});

/**
 * GET /v1/notifications
 *
 * `events.ts` has been writing these since messaging shipped; this is the read
 * side. Note it deliberately does NOT filter on `deliveryState` — that field
 * tracks whether the *notifications service* has pushed or emailed the event,
 * which is a separate concern from whether the user has seen it in-app. Mixing
 * them would hide in-app notifications whenever the push pipeline lagged.
 */
notificationsRouter.get(
  '/',
  validate(ListQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { limit, unreadOnly } = validated<typeof ListQuery>(req, 'query');

    const snap = await db()
      .collection(Collections.notifications)
      .where('accountId', '==', req.auth.accountId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    let items = snap.docs.map((d) => serialise<NotificationRecord>({ id: d.id, ...d.data() }));

    // Filtered in-process rather than in the query: adding `readAt == null` as
    // an equality filter would need yet another composite index for a list that
    // is capped at 50 documents anyway.
    if (unreadOnly) items = items.filter((n) => !n.readAt);

    sendOk(res, {
      items,
      unreadCount: items.filter((n) => !n.readAt).length,
    });
  }),
);

/** Badge count only — cheap enough to poll from the app shell. */
notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();

    const snap = await db()
      .collection(Collections.notifications)
      .where('accountId', '==', req.auth.accountId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const count = snap.docs.filter((d) => !d.data().readAt).length;
    // Capped at the query limit, so 50 means "50 or more". The UI renders
    // anything above 9 as "9+", so the imprecision never surfaces.
    sendOk(res, { count });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();

    const ref = db().collection(Collections.notifications).doc(param(req, 'id'));
    const snap = await ref.get();
    if (!snap.exists) throw notFound('That notification');
    if (snap.data()?.accountId !== req.auth.accountId) {
      throw forbidden('That notification is not yours.');
    }

    const readAt = nowIso();
    await ref.update({ readAt });
    sendOk(res, { readAt });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();

    const snap = await db()
      .collection(Collections.notifications)
      .where('accountId', '==', req.auth.accountId)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const unread = snap.docs.filter((d) => !d.data().readAt);
    if (unread.length === 0) {
      sendOk(res, { marked: 0 });
      return;
    }

    const readAt = nowIso();
    // Firestore caps a batch at 500 writes; the query above caps at 200, so a
    // single batch always suffices.
    const batch = db().batch();
    for (const doc of unread) batch.update(doc.ref, { readAt });
    await batch.commit();

    sendOk(res, { marked: unread.length });
  }),
);

/** Clears everything already read, so the list does not grow without bound. */
notificationsRouter.delete(
  '/read',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();

    const snap = await db()
      .collection(Collections.notifications)
      .where('accountId', '==', req.auth.accountId)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const read = snap.docs.filter((d) => Boolean(d.data().readAt));
    if (read.length === 0) {
      sendOk(res, { deleted: 0 });
      return;
    }

    const batch = db().batch();
    for (const doc of read) batch.delete(doc.ref);
    await batch.commit();

    sendOk(res, { deleted: read.length });
  }),
);
