import type { Request } from 'express';
import { env } from '../config/env.js';

/**
 * Every web origin allowed to talk to this API.
 *
 * Lives here rather than in app.ts because the share routes need it too, and
 * importing it from app.ts would be a cycle — app.ts mounts those routes.
 */
export function allowedWebOrigins(): Set<string> {
  const origins = new Set(env.CORS_ORIGINS);

  if (env.FIREBASE_PROJECT_ID) {
    origins.add(`https://${env.FIREBASE_PROJECT_ID}.web.app`);
    origins.add(`https://${env.FIREBASE_PROJECT_ID}.firebaseapp.com`);
  }

  origins.add(env.WEB_APP_ORIGIN);

  return origins;
}

/**
 * Which web app a share page should send this visitor back to.
 *
 * The app runs on more than one host (Firebase Hosting and Vercel), and a
 * Vercel visitor bounced to the Firebase origin would silently change hosts
 * mid-navigation — losing their session, since Firebase Auth persistence is
 * per-origin.
 *
 * Vercel sets `x-forwarded-host` when it proxies to an external destination, so
 * that header tells us where the request actually came from. It is attacker-
 * controlled on a direct request, which is why the result is only ever used
 * after matching it against the allowlist: an unrecognised host falls back to
 * the configured origin rather than becoming an open redirect.
 */
export function resolveWebOrigin(req: Request): string {
  const forwarded = req.get('x-forwarded-host') ?? req.get('host');
  if (!forwarded) return env.WEB_APP_ORIGIN;

  const host = forwarded.split(',')[0]!.trim();
  const allowed = allowedWebOrigins();

  for (const protocol of ['https', 'http']) {
    const candidate = `${protocol}://${host}`;
    if (allowed.has(candidate)) return candidate;
  }

  return env.WEB_APP_ORIGIN;
}
