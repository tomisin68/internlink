import { Router } from 'express';
import {
  CreateReportSchema,
  PeopleQuerySchema,
  RespondToConnectionSchema,
  SendConnectionRequestSchema,
  type CreateReportInput,
  type RespondToConnectionInput,
  type SendConnectionRequestInput,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendCreated, sendOk } from '../../lib/respond.js';
import { unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import { peekQuota } from '../../lib/daily-quota.js';
import * as connections from './connections.service.js';
import * as people from './people.service.js';
import { createUserReport } from '../moderation/moderation.service.js';
import { emit } from '../notifications/events.js';

export const networkRouter = Router();

networkRouter.use(requireAuth);

/* =============================================================== people === */

/**
 * GET /v1/network/people — FR-1006, the people directory.
 *
 * Returns the redacted `PersonSummary` view with the relationship already
 * resolved, so the client knows whether to draw Connect, Pending or Message
 * without a second request per row.
 */
networkRouter.get(
  '/people',
  validate(PeopleQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const query = validated<typeof PeopleQuerySchema>(req, 'query');
    sendOk(res, { items: await people.listPeople(req.auth.accountId, query) });
  }),
);

/* ========================================================== connections === */

networkRouter.get(
  '/connections',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const accounts = await connections.listConnections(req.auth.accountId);
    sendOk(res, {
      items: await people.summariseAccounts(
        req.auth.accountId,
        accounts.map((a) => a.id),
      ),
    });
  }),
);

/**
 * Requests waiting on you, each with the requester attached.
 *
 * The bare `ConnectionRecord` carries only IDs, which left the UI rendering
 * "Someone wants to connect" — an unanswerable prompt. Deciding needs a name,
 * a face, and how you know them.
 */
networkRouter.get(
  '/connections/pending',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const records = await connections.listPendingRequests(req.auth.accountId);
    const summaries = await people.summariseAccounts(
      req.auth.accountId,
      records.map((r) => r.requesterId),
    );
    const byId = new Map(summaries.map((s) => [s.id, s]));

    sendOk(res, {
      items: records
        .map((record) => ({ request: record, person: byId.get(record.requesterId) ?? null }))
        // A request whose requester has since been deleted has nothing to show.
        .filter((entry) => entry.person !== null),
    });
  }),
);

/** Lets the UI disable the button before the user hits the cap (FR-1102). */
networkRouter.get(
  '/connections/quota',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, await peekQuota(req.auth.accountId, 'connection_request'));
  }),
);

networkRouter.post(
  '/connections',
  writeLimiter,
  validate(SendConnectionRequestSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { recipientId, message } = req.body as SendConnectionRequestInput;

    const record = await connections.sendConnectionRequest(
      req.auth.accountId,
      recipientId,
      message,
    );

    void emit({
      accountId: recipientId,
      type: record.status === 'accepted' ? 'connection_accepted' : 'connection_request',
      payload: { connectionId: record.id, fromAccountId: req.auth.accountId },
    });

    sendCreated(res, record);
  }),
);

networkRouter.post(
  '/connections/:id/respond',
  validate(RespondToConnectionSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { accept } = req.body as RespondToConnectionInput;

    const record = await connections.respondToConnection(
      req.auth.accountId,
      param(req, 'id'),
      accept,
    );

    if (accept) {
      void emit({
        accountId: record.requesterId,
        type: 'connection_accepted',
        payload: { connectionId: record.id, byAccountId: req.auth.accountId },
      });
    }

    sendOk(res, record);
  }),
);

networkRouter.delete(
  '/connections/:accountId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.removeConnection(req.auth.accountId, param(req, 'accountId'));
    sendOk(res, { removed: true });
  }),
);

networkRouter.get(
  '/relationship/:accountId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, {
      relationship: await connections.resolveRelationship(
        req.auth.accountId,
        param(req, 'accountId'),
      ),
    });
  }),
);

/* ============================================================== follows === */

/**
 * FR-1006 — following people, not just companies.
 *
 * Connecting is mutual and needs approval; following is one-sided and does not.
 * Wanting someone's posts without asking for their attention is the common
 * case, and forcing it through a connection request is what makes a network
 * feel like paperwork.
 */
networkRouter.post(
  '/follows/accounts/:accountId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const targetId = param(req, 'accountId');
    await connections.follow(req.auth.accountId, 'account', targetId);

    void emit({
      accountId: targetId,
      type: 'new_follower',
      payload: { byAccountId: req.auth.accountId },
    });

    sendOk(res, { following: true });
  }),
);

networkRouter.delete(
  '/follows/accounts/:accountId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.unfollow(req.auth.accountId, param(req, 'accountId'));
    sendOk(res, { following: false });
  }),
);

networkRouter.get(
  '/follows/counts/:accountId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, await connections.followCounts(param(req, 'accountId')));
  }),
);

networkRouter.post(
  '/follows/companies/:companyId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.follow(req.auth.accountId, 'company', param(req, 'companyId'));
    sendOk(res, { following: true });
  }),
);

networkRouter.delete(
  '/follows/companies/:companyId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.unfollow(req.auth.accountId, param(req, 'companyId'));
    sendOk(res, { following: false });
  }),
);

networkRouter.get(
  '/follows',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const follows = await connections.followedIds(req.auth.accountId);
    sendOk(res, {
      companyIds: [...follows.companies],
      accountIds: [...follows.accounts],
    });
  }),
);

/**
 * Legacy company-follow route.
 *
 * Kept because a cached client build still calls it. Declared *after* the
 * `/follows/accounts/...` routes so its `:companyId` parameter cannot swallow
 * the word "accounts" — a bare `:param` segment matches anything, and route
 * order is the only thing that decides.
 */
networkRouter.post(
  '/follows/:companyId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.follow(req.auth.accountId, 'company', param(req, 'companyId'));
    sendOk(res, { following: true });
  }),
);

networkRouter.delete(
  '/follows/:companyId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.unfollow(req.auth.accountId, param(req, 'companyId'));
    sendOk(res, { following: false });
  }),
);

/* ====================================================== blocks & reports == */

/** FR-509 — blocking also severs the connection and closes shared threads. */
networkRouter.post(
  '/blocks/:accountId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.blockAccount(req.auth.accountId, param(req, 'accountId'));
    sendOk(res, { blocked: true });
  }),
);

networkRouter.delete(
  '/blocks/:accountId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.unblockAccount(req.auth.accountId, param(req, 'accountId'));
    sendOk(res, { blocked: false });
  }),
);

/** FR-702 — report anything: listing, message, post, profile or company. */
networkRouter.post(
  '/reports',
  writeLimiter,
  validate(CreateReportSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const input = req.body as CreateReportInput;

    const flag = await createUserReport({
      reporterId: req.auth.accountId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      detail: input.detail,
    });

    // §9.3 — the reporter is told what happens next, not just "submitted".
    sendCreated(res, {
      id: flag.id,
      severity: flag.severity,
      message:
        flag.severity === 'critical'
          ? 'Thanks — this goes to the top of our review queue. We will follow up by email.'
          : 'Thanks for reporting. Our team will review this and take action if needed.',
    });
  }),
);
