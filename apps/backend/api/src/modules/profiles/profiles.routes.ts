import { Router } from 'express';
import {
  CreateInternProfileSchema,
  CreateRecruiterProfileSchema,
  UpdateInternProfileSchema,
  type CreateInternProfileInput,
  type CreateRecruiterProfileInput,
  type UpdateInternProfileInput,
} from '@internlink/shared-types';
import { asyncHandler } from '../../lib/async-handler.js';
import { sendCreated, sendOk } from '../../lib/respond.js';
import { notFound, unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import * as profilesService from './profiles.service.js';
import * as companiesService from '../companies/companies.service.js';
import { getAccount } from '../auth/auth.service.js';

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
