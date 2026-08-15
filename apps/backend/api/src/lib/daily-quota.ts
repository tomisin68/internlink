import { FieldValue } from 'firebase-admin/firestore';
import { Collections, db } from '../config/firebase.js';
import { env } from '../config/env.js';
import { rateLimited } from './errors.js';
import { logger } from './logger.js';

/**
 * FR-1102 — per-account daily caps on outreach.
 *
 * This exists because `middleware/rate-limit.ts` cannot do this job. That
 * limiter is in-memory and per-instance, so with N API instances the effective
 * ceiling is N × the limit — fine for throttling brute force, useless for a
 * quota that has to mean one specific number.
 *
 * Counters live in Firestore keyed by `{accountId}_{action}_{utcDay}`, and are
 * incremented inside a transaction so two concurrent requests cannot both read
 * 39, both write 40, and let 41 through.
 */

export type QuotaAction = 'connection_request' | 'cold_message' | 'post' | 'report';

function limitFor(action: QuotaAction): number {
  switch (action) {
    case 'connection_request':
      return env.MAX_CONNECTION_REQUESTS_PER_DAY;
    case 'cold_message':
      return env.MAX_COLD_MESSAGES_PER_DAY;
    case 'post':
      return 20;
    case 'report':
      return 30;
  }
}

/** UTC day bucket. Deliberately not local time — the server's timezone is not
 *  the user's, and a quota that resets at an unpredictable hour is worse than
 *  one that resets at a consistent, if arbitrary, one. */
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface QuotaResult {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Consumes one unit of quota, throwing if the cap is already reached.
 *
 * Fails *open* on an infrastructure error: if Firestore is unreachable, a user
 * sending their fifth message of the day should not be blocked because our
 * counter is down. The abuse this prevents is bulk and automated; letting a
 * handful through during an outage is the cheaper failure.
 */
export async function consumeQuota(
  accountId: string,
  action: QuotaAction,
  now = new Date(),
): Promise<QuotaResult> {
  const limit = limitFor(action);
  const docId = `${accountId}_${action}_${dayKey(now)}`;
  const ref = db().collection(Collections.rateLimits).doc(docId);

  try {
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = (snap.data()?.count as number | undefined) ?? 0;

      if (used >= limit) {
        // Seconds until the next UTC midnight, so Retry-After is honest.
        const nextReset = Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 1,
        );
        throw rateLimited(Math.ceil((nextReset - now.getTime()) / 1000));
      }

      tx.set(
        ref,
        {
          accountId,
          action,
          day: dayKey(now),
          count: FieldValue.increment(1),
          // Lets a scheduled cleanup drop yesterday's counters cheaply.
          expiresAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
        },
        { merge: true },
      );

      return { used: used + 1, limit, remaining: limit - used - 1 };
    });
  } catch (error) {
    // Re-throw our own quota rejection; swallow anything else.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'rate_limited') {
      throw error;
    }
    logger.error({ err: error, accountId, action }, 'Daily quota check failed — allowing through');
    return { used: 0, limit, remaining: limit };
  }
}

/** Reads remaining quota without consuming any. Used to pre-disable UI. */
export async function peekQuota(
  accountId: string,
  action: QuotaAction,
  now = new Date(),
): Promise<QuotaResult> {
  const limit = limitFor(action);
  try {
    const snap = await db()
      .collection(Collections.rateLimits)
      .doc(`${accountId}_${action}_${dayKey(now)}`)
      .get();
    const used = (snap.data()?.count as number | undefined) ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
  } catch {
    return { used: 0, limit, remaining: limit };
  }
}
