import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { sendError } from '../lib/respond.js';
import { isProduction } from '../config/env.js';

/**
 * In-memory, per-instance limiting — SRS §3.3 explicitly rules out Redis.
 *
 * The trade-off is real and worth stating: with N API instances behind the load
 * balancer, the effective ceiling is N × the configured limit. That is fine for
 * the abuse classes these limits target (scripted credential stuffing, bulk
 * cold outreach) and not fine for anything requiring an exact quota. The
 * per-account daily caps in FR-1102 are therefore counted in Firestore, not
 * here — see the service layer under `modules/`.
 */
function buildLimiter(opts: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Skip entirely in dev so nobody rate-limits themselves debugging a form.
    skip: () => !isProduction,
    handler: (req: Request, res, _next, options) => {
      sendError(res, {
        status: 429,
        code: 'rate_limited',
        message: 'Too many attempts. Try again shortly.',
        requestId: req.requestId,
        retryAfterSeconds: Math.ceil(options.windowMs / 1000),
      });
    },
    ...opts,
  });
}

/** Baseline for the whole API surface. */
export const globalLimiter = buildLimiter({
  windowMs: 60_000,
  limit: 240,
});

/**
 * Sign-in / sign-up / reset. Deliberately tight and keyed on IP + email so one
 * attacker cannot lock out an entire office NAT by hammering one address.
 */
export const authLimiter = buildLimiter({
  windowMs: 15 * 60_000,
  limit: 20,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${req.ip ?? 'unknown'}:${email}`;
  },
});

/** Writes that create content — cheap to make, expensive to moderate. */
export const writeLimiter = buildLimiter({
  windowMs: 60_000,
  limit: 30,
});

/** Signed-upload handshakes. Each one is a Cloudinary credential grant. */
export const uploadLimiter = buildLimiter({
  windowMs: 60_000,
  limit: 20,
});
