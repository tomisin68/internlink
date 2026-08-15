import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendOk } from '../../lib/respond.js';
import { forbidden, notFound, unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { Collections, db } from '../../config/firebase.js';
import { nowIso, serialise } from '../../lib/firestore.js';
import type { NotificationType } from './events.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

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
