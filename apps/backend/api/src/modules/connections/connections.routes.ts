import { Router } from 'express';
import {
  CreateReportSchema,
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
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import { peekQuota } from '../../lib/daily-quota.js';
import * as connections from './connections.service.js';
import { createUserReport } from '../moderation/moderation.service.js';
import { emit } from '../notifications/events.js';

export const networkRouter = Router();

networkRouter.use(requireAuth);

/* ========================================================== connections === */

networkRouter.get(
  '/connections',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, { items: await connections.listConnections(req.auth.accountId) });
  }),
);

networkRouter.get(
  '/connections/pending',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, { items: await connections.listPendingRequests(req.auth.accountId) });
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

networkRouter.post(
  '/follows/:companyId',
  writeLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.followCompany(req.auth.accountId, param(req, 'companyId'));
    sendOk(res, { following: true });
  }),
);

networkRouter.delete(
  '/follows/:companyId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await connections.unfollowCompany(req.auth.accountId, param(req, 'companyId'));
    sendOk(res, { following: false });
  }),
);

networkRouter.get(
  '/follows',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, { companyIds: [...(await connections.followedCompanyIds(req.auth.accountId))] });
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
