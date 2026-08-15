import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ActiveRole, Role } from '@internlink/shared-types';
import { firebaseAuth } from '../config/firebase.js';
import { accountRestricted, forbidden, roleNotHeld, tokenExpired, unauthenticated } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Custom claims we mint onto the Firebase user.
 *
 * SRS §3.5 wants an `active_role` claim so switching roles reissues a token
 * without a fresh login. Firebase custom claims are exactly that mechanism:
 * we write the claim, the client force-refreshes its ID token, and the next
 * request arrives already scoped to the new role.
 */
export interface InternLinkClaims {
  active_role?: ActiveRole;
  roles?: Role[];
  status?: 'active' | 'restricted' | 'suspended' | 'banned';
}

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

/**
 * §5.2 — RBAC is enforced server-side on every endpoint and never trusted from
 * client state. The role this middleware attaches comes from the verified token
 * claim, not from a header or body field the caller controls.
 */
export const requireAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = extractBearer(req);
    if (!token) {
      next(unauthenticated());
      return;
    }

    // checkRevoked:true costs an extra lookup but means a signed-out or
    // disabled session stops working immediately rather than at token expiry.
    const decoded = await firebaseAuth().verifyIdToken(token, true);
    const claims = decoded as unknown as InternLinkClaims & { uid: string; email?: string; email_verified?: boolean };

    if (claims.status === 'banned' || claims.status === 'suspended') {
      next(
        accountRestricted(
          'This account has been suspended. Check your email for details, or appeal from the help centre.',
        ),
      );
      return;
    }

    const roles = claims.roles ?? [];
    req.auth = {
      accountId: decoded.uid,
      email: claims.email ?? '',
      emailVerified: Boolean(claims.email_verified),
      roles,
      // A token minted before the user picked a role has no active_role yet;
      // fall back to their first held role, then to intern.
      activeRole: claims.active_role ?? roles[0] ?? 'intern',
    };

    next();
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/id-token-expired' || code === 'auth/id-token-revoked') {
      next(tokenExpired());
      return;
    }
    logger.warn({ err: error, requestId: req.requestId }, 'Token verification failed');
    next(unauthenticated('We could not verify your session. Sign in again.'));
  }
};

/**
 * Attaches auth when a valid token is present but does not demand one.
 * Used on public listing reads, where a signed-in user gets personalised
 * results and an anonymous one still gets the page.
 */
export const optionalAuth: RequestHandler = async (req, res, next) => {
  if (!extractBearer(req)) {
    next();
    return;
  }
  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      // A bad token on an optional route degrades to anonymous rather than 401.
      req.auth = undefined;
    }
    next();
  });
};

/** Requires the *active* role to be one of `allowed` — FR-103's whole point. */
export function requireRole(...allowed: ActiveRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    if (!allowed.includes(req.auth.activeRole)) {
      next(
        forbidden(
          `Switch to your ${allowed[0]} profile to do this.`,
        ),
      );
      return;
    }
    next();
  };
}

/** Requires the account to *hold* the role, regardless of what it is acting as. */
export function requireHeldRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    if (!req.auth.roles.includes(role)) {
      next(roleNotHeld(role));
      return;
    }
    next();
  };
}

/** FR-106 — admin is provisioned, never self-registered. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(unauthenticated());
    return;
  }
  if (!req.auth.roles.includes('admin')) {
    next(forbidden('Admin access only.'));
    return;
  }
  next();
};
