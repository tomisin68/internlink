import { Router } from 'express';
import { z } from 'zod';
import {
  CreateInternProfileSchema,
  CreateRecruiterProfileSchema,
  UpdateInternProfileSchema,
  type CreateInternProfileInput,
  type CreateRecruiterProfileInput,
  type UpdateInternProfileInput,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendCreated, sendOk } from '../../lib/respond.js';
import { notFound, unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import * as profilesService from './profiles.service.js';
import * as companiesService from '../companies/companies.service.js';
import * as people from '../connections/people.service.js';
import { getAccount } from '../auth/auth.service.js';
import { connectedIds, followCounts } from '../connections/connections.service.js';
import { Collections, db } from '../../config/firebase.js';
import { listProfileViewers, recordProfileView } from './profile-views.service.js';

export const profilesRouter = Router();

profilesRouter.use(requireAuth);

/**
 * POST /v1/profiles/intern — completes the intern side of onboarding.
 *
 * Note this does *not* require the `intern` active role: the user is sent here
 * by `nextStep: create_intern_profile`, which is precisely the state where they
 * hold the role but have nothing to act as yet.
 */
profilesRouter.post(
  '/intern',
  writeLimiter,
  validate(CreateInternProfileSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const input = req.body as CreateInternProfileInput;
    sendCreated(res, await profilesService.upsertInternProfile(req.auth.accountId, input));
  }),
);

profilesRouter.get(
  '/intern/me',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const profile = await profilesService.getInternProfile(req.auth.accountId);
    if (!profile) throw notFound('Your intern profile');
    sendOk(res, profile);
  }),
);

profilesRouter.patch(
  '/intern/me',
  writeLimiter,
  validate(UpdateInternProfileSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const input = req.body as UpdateInternProfileInput;
    sendOk(res, await profilesService.patchInternProfile(req.auth.accountId, input));
  }),
);

/** FR-202 — what to nudge the user about, in priority order. */
profilesRouter.get(
  '/intern/me/completeness',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const [profile, account] = await Promise.all([
      profilesService.getInternProfile(req.auth.accountId),
      getAccount(req.auth.accountId),
    ]);
    if (!profile || !account) throw notFound('Your intern profile');
    sendOk(res, {
      score: profile.completeness,
      missing: profilesService.missingCompletenessItems(profile, account),
    });
  }),
);

/**
 * GET /v1/profiles/me/stats — the numbers on your own profile header.
 *
 * The public profile route has carried these since it was written; your own
 * screen was the one place that could not see them, because it renders from the
 * session payload rather than from a profile fetch. Rather than bloat the
 * session with counts that change constantly, this is its own small read.
 */
profilesRouter.get(
  '/me/stats',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { accountId } = req.auth;

    const [counts, connections, postCount, account] = await Promise.all([
      followCounts(accountId),
      connectedIds(accountId),
      db().collection(Collections.posts).where('authorAccountId', '==', accountId).count().get(),
      getAccount(accountId),
    ]);

    sendOk(res, {
      followers: counts.followers,
      following: counts.following,
      connections: connections.length,
      posts: postCount.data().count,
      joinedAt: account?.createdAt ?? null,
    });
  }),
);

/**
 * GET /v1/profiles/me/views — FR-1001, who looked at your profile.
 *
 * Deliberately `me`-only. A route that let anyone read anyone's viewer list
 * would turn a mild vanity feature into a surveillance one.
 */
const ViewsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

profilesRouter.get(
  '/me/views',
  validate(ViewsQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { limit } = validated<typeof ViewsQuery>(req, 'query');
    sendOk(res, await listProfileViewers(req.auth.accountId, limit));
  }),
);

/** POST /v1/profiles/recruiter — creates company + recruiter profile together. */
profilesRouter.post(
  '/recruiter',
  writeLimiter,
  validate(CreateRecruiterProfileSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const input = req.body as CreateRecruiterProfileInput;
    sendCreated(res, await companiesService.createRecruiterProfile(req.auth.accountId, input));
  }),
);

profilesRouter.get(
  '/recruiter/me',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const profile = await companiesService.getRecruiterProfile(req.auth.accountId);
    if (!profile) throw notFound('Your recruiter profile');
    const company = profile.companyId ? await companiesService.getCompany(profile.companyId) : null;
    sendOk(res, { profile, company });
  }),
);

/**
 * GET /v1/profiles/:accountId — somebody else's profile.
 *
 * Declared last: a bare `:accountId` segment matches "intern" and "recruiter"
 * too, so it must sit below every literal route above it or it swallows them.
 *
 * The response is assembled per viewer — relationship, follow state and FR-1105
 * visibility all depend on who is asking, so this can never be a cached
 * document read.
 */
profilesRouter.get(
  '/:accountId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const subjectId = param(req, 'accountId');

    const profile = await people.getPublicProfile(
      req.auth.accountId,
      req.auth.activeRole,
      subjectId,
    );

    // Detached and after the read succeeded: recording a view must never be
    // able to slow down or fail the thing the visitor actually asked for, and
    // a view of a profile that 404'd is not a view.
    void recordProfileView(req.auth.accountId, subjectId);

    sendOk(res, profile);
  }),
);
