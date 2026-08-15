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
import { notFound, unauthenticated } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import * as feed from './feed.service.js';
import * as posts from '../posts/posts.service.js';
import * as engagement from '../posts/engagement.service.js';
import { hydratePostAuthor } from '../posts/author-hydration.js';
import { followedIds } from '../connections/connections.service.js';

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

/**
 * GET /v1/feed/posts/:id — a single post, for the permalink route.
 *
 * What a shared link resolves to. Returns the viewer-relative state too, so a
 * post opened from a link renders a fully working card rather than a read-only
 * stub that has lost every action the feed has.
 */
feedRouter.get(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { accountId } = req.auth;
    const id = param(req, 'id');

    const raw = await posts.getPost(id);
    if (!raw) throw notFound('That post');
    // A flagged post is visible to its author and nobody else — same rule the
    // feed ranker applies, restated here because this route bypasses the feed.
    if (raw.isFlagged && raw.authorAccountId !== accountId) {
      throw notFound('That post');
    }

    // Likes and comments on a reshare belong to the original, so the card shows
    // the original's numbers — see `resolveInteractionTarget`.
    const target = await posts.resolveInteractionTarget(id);
    const [post, hasReacted, isBookmarked, reactors, follows] = await Promise.all([
      hydratePostAuthor(raw),
      posts.hasReacted(accountId, target.id),
      engagement.isBookmarked(accountId, id),
      engagement.listReactors(target.id, 12),
      followedIds(accountId),
    ]);

    sendOk(res, {
      post:
        target.id === post.id
          ? post
          : {
              ...post,
              reactionCount: target.reactionCount,
              commentCount: target.commentCount,
              shareCount: target.shareCount ?? 0,
              allowResharing: target.allowResharing,
            },
      hasReacted,
      isBookmarked,
      isFollowingAuthor:
        post.author.kind === 'company'
          ? follows.companies.has(post.author.id)
          : follows.accounts.has(post.author.id),
      reactors,
      shareUrl: `${env.WEB_APP_ORIGIN}/p/${id}`,
    });
  }),
);

/**
 * FR-1007 — saving a post.
 *
 * A toggle rather than separate verbs: the client already knows the current
 * state from the feed payload, and a POST/DELETE pair invites the two to
 * disagree when a tap races a refresh.
 */
feedRouter.post(
  '/posts/:id/bookmarks',
  writeLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, await engagement.toggleBookmark(req.auth.accountId, param(req, 'id')));
  }),
);

feedRouter.delete(
  '/posts/:id/bookmarks',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, await engagement.setBookmark(req.auth.accountId, param(req, 'id'), false));
  }),
);

/** Who reacted — what the "Liked by…" line expands into. */
feedRouter.get(
  '/posts/:id/reactions',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const target = await posts.resolveInteractionTarget(param(req, 'id'));
    sendOk(res, { items: await engagement.listReactors(target.id, 60) });
  }),
);

/**
 * People the composer can tag.
 *
 * Scoped to the author's connections and follows — see `resolveMentions` for
 * why "anyone can tag anyone" is not the default here.
 */
const MentionQuery = z.object({ q: z.string().trim().max(80).default('') });

feedRouter.get(
  '/mentions',
  validate(MentionQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { q } = validated<typeof MentionQuery>(req, 'query');
    sendOk(res, { items: await engagement.mentionCandidates(req.auth.accountId, q) });
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
