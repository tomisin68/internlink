import { Router } from 'express';
import {
  ModerationQuerySchema,
  ResolveFlagSchema,
  type Account,
  type ModerationFlag,
  type ModerationFlagView,
  type ModerationStats,
  type ResolveFlagInput,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendOk } from '../../lib/respond.js';
import { badRequest, notFound, unauthenticated } from '../../lib/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { Collections, db } from '../../config/firebase.js';
import { serialise } from '../../lib/firestore.js';
import { loadTargets, resolveFlag, moderationStats } from './moderation.service.js';

/**
 * §9.3 / FR-1107 — the moderation console.
 *
 * Staff-only, enforced by the `admin` role claim rather than by hiding the
 * route in the UI. The Firestore rules already refuse client reads of
 * `moderationFlags` outright, so this API is the only way in and the check
 * lives in exactly one place.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.get(
  '/moderation/stats',
  asyncHandler(async (_req, res) => {
    const stats: ModerationStats = await moderationStats();
    sendOk(res, stats);
  }),
);

/**
 * The queue, priority-ordered.
 *
 * Critical first, then oldest within a severity — a scam report that has sat
 * for a day outranks one filed a minute ago, and both outrank spam. That
 * ordering is the whole reason a single queue works across content types.
 */
adminRouter.get(
  '/moderation',
  validate(ModerationQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = validated<typeof ModerationQuerySchema>(req, 'query');

    const snap = await db()
      .collection(Collections.moderationFlags)
      .where('status', '==', query.status)
      .orderBy('severity', 'asc')
      .orderBy('createdAt', 'asc')
      .limit(query.limit)
      .get();

    const flags = snap.docs.map((d) => serialise<ModerationFlag>({ id: d.id, ...d.data() }));

    // The reported content is attached here rather than fetched per row by the
    // client: a queue where every entry needs a click to find out what it is
    // does not get worked.
    const items: ModerationFlagView[] = await loadTargets(flags);
    sendOk(res, { items });
  }),
);

adminRouter.post(
  '/moderation/:id/resolve',
  validate(ResolveFlagSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const input = req.body as ResolveFlagInput;

    // §9.3 — anything beyond a dismissal is an action against a person and has
    // to carry a reason. The audit trail is the point: a moderator decision
    // nobody can explain later is indistinguishable from an arbitrary one.
    if (input.action !== 'dismiss' && !input.note) {
      throw badRequest('Add a note explaining this action.', {
        note: ['A note is required for anything other than dismissing.'],
      });
    }

    const flag = await resolveFlag({
      flagId: param(req, 'id'),
      moderatorId: req.auth.accountId,
      action: input.action,
      note: input.note,
    });

    sendOk(res, flag);
  }),
);

/** Enough of an account to judge a report against it. */
adminRouter.get(
  '/accounts/:accountId',
  asyncHandler(async (req, res) => {
    const accountId = param(req, 'accountId');
    const snap = await db().collection(Collections.accounts).doc(accountId).get();
    if (!snap.exists) throw notFound('That account');

    const account = serialise<Account>({ id: accountId, ...snap.data() });

    const flags = await db()
      .collection(Collections.moderationFlags)
      .where('targetId', '==', accountId)
      .limit(20)
      .get();

    sendOk(res, {
      account,
      priorFlags: flags.size,
    });
  }),
);
