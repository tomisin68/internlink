import { Router } from 'express';
import { z } from 'zod';
import {
  RespondToRequestSchema,
  SendMessageSchema,
  StartThreadSchema,
  type RespondToRequestInput,
  type SendMessageInput,
  type StartThreadInput,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendCreated, sendOk } from '../../lib/respond.js';
import { unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import * as messaging from './messaging.service.js';

export const messagingRouter = Router();

messagingRouter.use(requireAuth);

const ListThreadsQuery = z.object({
  box: z.enum(['primary', 'requests']).default('primary'),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

/** GET /v1/messages/threads?box=primary|requests — FR-506's two inboxes. */
messagingRouter.get(
  '/threads',
  validate(ListThreadsQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { box, limit } = validated<typeof ListThreadsQuery>(req, 'query');
    sendOk(res, await messaging.listThreads(req.auth.accountId, box, limit));
  }),
);

/** GET /v1/messages/summary — one call for every unread badge in the shell. */
messagingRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, await messaging.getInboxSummary(req.auth.accountId));
  }),
);

/** POST /v1/messages/threads — opens a conversation, or appends to the existing one. */
messagingRouter.post(
  '/threads',
  writeLimiter,
  validate(StartThreadSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const input = req.body as StartThreadInput;
    sendCreated(
      res,
      await messaging.startThread({
        senderId: req.auth.accountId,
        recipientId: input.recipientId,
        body: input.body,
        applicationId: input.applicationId ?? null,
        listingId: input.listingId ?? null,
      }),
    );
  }),
);

messagingRouter.get(
  '/threads/:id',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const thread = await messaging.getThread(param(req, 'id'));
    // Membership is checked by listMessages; this endpoint mirrors the same
    // not-found-over-forbidden rule.
    if (!thread || !thread.participantIds.includes(req.auth.accountId)) {
      sendOk(res, null, 404);
      return;
    }
    sendOk(res, thread);
  }),
);

const ListMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  before: z.string().optional(),
});

messagingRouter.get(
  '/threads/:id/messages',
  validate(ListMessagesQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { limit, before } = validated<typeof ListMessagesQuery>(req, 'query');
    sendOk(res, await messaging.listMessages(req.auth.accountId, param(req, 'id'), limit, before));
  }),
);

messagingRouter.post(
  '/threads/:id/messages',
  writeLimiter,
  validate(SendMessageSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const input = req.body as SendMessageInput;
    sendCreated(
      res,
      await messaging.sendMessage({
        threadId: param(req, 'id'),
        senderId: req.auth.accountId,
        body: input.body,
        attachments: input.attachments,
        sticker: input.sticker,
        replyToMessageId: input.replyToMessageId ?? null,
      }),
    );
  }),
);

messagingRouter.post(
  '/threads/:id/read',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await messaging.markThreadRead(req.auth.accountId, param(req, 'id'));
    sendOk(res, { read: true });
  }),
);

/** FR-506 — accept, decline, or decline-and-block. */
messagingRouter.post(
  '/threads/:id/respond',
  validate(RespondToRequestSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { accept, block } = req.body as RespondToRequestInput;
    sendOk(
      res,
      await messaging.respondToRequest(req.auth.accountId, param(req, 'id'), accept, block),
    );
  }),
);

const MuteSchema = z.object({ muted: z.boolean() });

messagingRouter.post(
  '/threads/:id/mute',
  validate(MuteSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { muted } = req.body as z.infer<typeof MuteSchema>;
    await messaging.setThreadMuted(req.auth.accountId, param(req, 'id'), muted);
    sendOk(res, { muted });
  }),
);
