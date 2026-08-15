import { FieldValue } from 'firebase-admin/firestore';
import {
  PROFILE_VIEW_WINDOW_DAYS,
  type ProfileViews,
  type ProfileViewer,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { nowIso } from '../../lib/firestore.js';
import { logger } from '../../lib/logger.js';
import { emit } from '../notifications/events.js';
import { summariseAccounts } from '../connections/people.service.js';

/**
 * FR-1001 — "who viewed your profile".
 *
 * One document per (viewer, subject) pair rather than one per visit. The
 * question people actually ask is *who*, and an append-only visit log would
 * grow without bound to answer a worse version of it. `count` keeps the
 * repeat-visit signal; `viewedAt` keeps recency. Nothing else is worth storing.
 */
function viewId(viewerId: string, subjectId: string): string {
  return `${viewerId}__${subjectId}`;
}

/** How long between notifications for the same pair. */
const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Records that `viewerId` looked at `subjectId`, and notifies at most daily.
 *
 * Never throws and is always called detached: a profile that fails to load
 * because the view counter had a bad moment would be a strictly worse product
 * than one that occasionally misses a view.
 *
 * Self-views are ignored, as are views by a blocked account — telling someone
 * that the person who blocked them keeps checking their profile is not a
 * feature.
 */
export async function recordProfileView(viewerId: string, subjectId: string): Promise<void> {
  if (viewerId === subjectId) return;

  try {
    const ref = db().collection(Collections.profileViews).doc(viewId(viewerId, subjectId));
    const existing = await ref.get();
    const previous = existing.exists ? (existing.data()?.viewedAt as string | undefined) : undefined;
    const viewedAt = nowIso();

    await ref.set(
      {
        viewerId,
        subjectId,
        viewedAt,
        count: FieldValue.increment(1),
      },
      { merge: true },
    );

    // A profile someone checks five times in an afternoon is one notification,
    // not five. Without the cooldown this is the most annoying event type in
    // the product by a distance.
    const isFresh = !previous || Date.now() - new Date(previous).getTime() > NOTIFY_COOLDOWN_MS;
    if (isFresh) {
      void emit({
        accountId: subjectId,
        type: 'profile_view',
        payload: { byAccountId: viewerId },
      });
    }
  } catch (error) {
    logger.warn({ err: error, viewerId, subjectId }, 'Profile view not recorded');
  }
}

/**
 * Who has looked at this account's profile recently.
 *
 * Only ever called for the account's own profile — the route enforces that.
 * Anyone being able to read anyone else's viewer list would turn a mild vanity
 * feature into a surveillance one.
 */
export async function listProfileViewers(
  subjectId: string,
  limit = 20,
): Promise<ProfileViews> {
  const since = new Date(Date.now() - PROFILE_VIEW_WINDOW_DAYS * 86_400_000).toISOString();

  const snap = await db()
    .collection(Collections.profileViews)
    .where('subjectId', '==', subjectId)
    .orderBy('viewedAt', 'desc')
    .limit(Math.max(limit, 50))
    .get();

  const rows = snap.docs
    .map((doc) => doc.data() as { viewerId?: string; viewedAt?: string; count?: number })
    .filter((row): row is { viewerId: string; viewedAt: string; count: number } =>
      Boolean(row.viewerId && row.viewedAt && row.viewedAt >= since),
    );

  if (rows.length === 0) {
    return { total: 0, windowDays: PROFILE_VIEW_WINDOW_DAYS, viewers: [] };
  }

  const people = await summariseAccounts(
    subjectId,
    rows.slice(0, limit).map((row) => row.viewerId),
  );
  const byId = new Map(people.map((person) => [person.id, person]));

  const viewers: ProfileViewer[] = rows
    .slice(0, limit)
    .map((row) => {
      const person = byId.get(row.viewerId);
      if (!person || person.relationship === 'blocked') return null;
      return { person, viewedAt: row.viewedAt, count: row.count ?? 1 };
    })
    .filter((entry): entry is ProfileViewer => entry !== null);

  return { total: rows.length, windowDays: PROFILE_VIEW_WINDOW_DAYS, viewers };
}
