import { Router } from 'express';
import { z } from 'zod';
import {
  CreateCommentSchema,
  CreatePostSchema,
  FeedQuerySchema,
  MatchQuerySchema,
  ResharePostSchema,
  UpdatePostSchema,
  type CreateCommentInput,
  type CreatePostInput,
  type ResharePostInput,
  type UpdatePostInput,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendCreated, sendOk } from '../../lib/respond.js';
import { unauthenticated } from '../../lib/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import * as feed from './feed.service.js';
import * as posts from '../posts/posts.service.js';

export const feedRouter = Router();

feedRouter.use(requireAuth);

/** GET /v1/feed — FR-1007, the ranked activity feed. */
feedRouter.get(
  '/',
  validate(FeedQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const query = validated<typeof FeedQuerySchema>(req, 'query');
    sendOk(res, await feed.getFeed(req.auth.accountId, query));
  }),
);

/**
 * GET /v1/feed/matches — FR-204.
 *
 * Intern-only: matching scores a listing against an intern profile, and there
 * is no meaningful answer for a recruiter session.
 */
feedRouter.get(
  '/matches',
  requireRole('intern'),
  validate(MatchQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const query = validated<typeof MatchQuerySchema>(req, 'query');
    sendOk(res, await feed.getMatches(req.auth.accountId, query));
  }),
);

/* ================================================================= posts == */

feedRouter.post(
  '/posts',
  writeLimiter,
  validate(CreatePostSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendCreated(res, await posts.createPost(req.auth.accountId, req.body as CreatePostInput));
  }),
);

/** The author's own controls — currently the reshare switch (FR-1007). */
feedRouter.patch(
  '/posts/:id',
  writeLimiter,
  validate(UpdatePostSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(
      res,
      await posts.updatePost(req.auth.accountId, param(req, 'id'), req.body as UpdatePostInput),
    );
  }),
);

feedRouter.delete(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await posts.deletePost(req.auth.accountId, param(req, 'id'));
    sendOk(res, { deleted: true });
  }),
);

feedRouter.post(
  '/posts/:id/reactions',
  writeLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, await posts.toggleReaction(req.auth.accountId, param(req, 'id')));
  }),
);

feedRouter.post(
  '/posts/:id/reshares',
  writeLimiter,
  validate(ResharePostSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendCreated(
      res,
      await posts.resharePost(req.auth.accountId, param(req, 'id'), req.body as ResharePostInput),
    );
  }),
);

const CommentsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

feedRouter.get(
  '/posts/:id/comments',
  validate(CommentsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { limit } = validated<typeof CommentsQuery>(req, 'query');
    sendOk(res, {
      items: await posts.listComments(param(req, 'id'), limit, req.auth?.accountId ?? null),
    });
  }),
);

feedRouter.post(
  '/posts/:id/comments',
  writeLimiter,
  validate(CreateCommentSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendCreated(
      res,
      await posts.addComment(req.auth.accountId, param(req, 'id'), req.body as CreateCommentInput),
    );
  }),
);

feedRouter.post(
  '/posts/:id/comments/:commentId/reactions',
  writeLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(
      res,
      await posts.toggleCommentReaction(
        req.auth.accountId,
        param(req, 'id'),
        param(req, 'commentId'),
      ),
    );
  }),
);

feedRouter.delete(
  '/posts/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await posts.deleteComment(req.auth.accountId, param(req, 'id'), param(req, 'commentId'));
    sendOk(res, { deleted: true });
  }),
);
