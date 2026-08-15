import { Router } from 'express';
import {
  SelectRoleSchema,
  SessionExchangeSchema,
  SwitchRoleSchema,
  UpdateAccountImagesSchema,
  type SelectRoleInput,
  type SessionExchangeInput,
  type SwitchRoleInput,
  type UpdateAccountImagesInput,
} from '@internlink/shared-types';
import { asyncHandler } from '../../lib/async-handler.js';
import { sendOk } from '../../lib/respond.js';
import { unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter, writeLimiter } from '../../middleware/rate-limit.js';
import { firebaseAuth } from '../../config/firebase.js';
import * as authService from './auth.service.js';

export const authRouter = Router();

/**
 * POST /v1/auth/session
 *
 * Called immediately after the client SDK signs a user in — by password or by
 * Google. Creates the account document on first sight, returns the full
 * session payload including `nextStep`.
 *
 * Deliberately idempotent: calling it on every app boot is the intended usage.
 */
authRouter.post(
  '/session',
  authLimiter,
  requireAuth,
  validate(SessionExchangeSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const body = req.body as SessionExchangeInput;

    // displayName/photoURL live on the Firebase user record, not in the token
    // claims, so they need a lookup. Only matters on the create path but the
    // call is cheap and keeps the mirror fresh on every sign-in.
    const user = await firebaseAuth().getUser(req.auth.accountId);

    const session = await authService.exchangeSession({
      uid: req.auth.accountId,
      email: user.email ?? req.auth.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      photoUrl: user.photoURL,
      firstName: body.firstName,
      lastName: body.lastName,
    });

    sendOk(res, session);
  }),
);

/** GET /v1/auth/me — rehydrates the session on app boot / tab focus. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, await authService.getSession(req.auth.accountId));
  }),
);

/**
 * POST /v1/auth/role — FR-104. Grants a role and makes it active.
 *
 * The client must force-refresh its ID token afterwards; the new `active_role`
 * claim only lands on the next minted token. The response carries the updated
 * session so the UI can move on without waiting for that round trip.
 */
authRouter.post(
  '/role',
  requireAuth,
  validate(SelectRoleSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { role } = req.body as SelectRoleInput;
    sendOk(res, await authService.selectRole(req.auth.accountId, role));
  }),
);

/** POST /v1/auth/switch-role — FR-103. No re-authentication. */
authRouter.post(
  '/switch-role',
  requireAuth,
  validate(SwitchRoleSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { role } = req.body as SwitchRoleInput;
    sendOk(res, await authService.switchRole(req.auth.accountId, role));
  }),
);

/** POST /v1/auth/complete-onboarding — stops the wizard intercepting routes. */
authRouter.post(
  '/complete-onboarding',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(res, await authService.completeOnboarding(req.auth.accountId));
  }),
);

/**
 * PATCH /v1/auth/me/images — profile photo and cover image.
 *
 * Separate from the profile wizards: changing your photo is a one-tap action
 * people expect from their own profile screen, not something worth re-entering
 * a four-step wizard for. Returns the whole session so the header updates
 * everywhere at once instead of only where the change was made.
 */
authRouter.patch(
  '/me/images',
  requireAuth,
  writeLimiter,
  validate(UpdateAccountImagesSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    sendOk(
      res,
      await authService.updateAccountImages(
        req.auth.accountId,
        req.body as UpdateAccountImagesInput,
      ),
    );
  }),
);

/**
 * POST /v1/auth/sign-out — revokes refresh tokens for the account.
 *
 * The client clears its own state regardless; this exists so "sign out
 * everywhere" is real. `requireAuth` verifies with checkRevoked, so other
 * devices stop working on their next request rather than at token expiry.
 */
authRouter.post(
  '/sign-out',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    await firebaseAuth().revokeRefreshTokens(req.auth.accountId);
    sendOk(res, { signedOut: true });
  }),
);
