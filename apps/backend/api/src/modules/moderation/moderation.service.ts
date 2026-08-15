import type {
  ModerationAction,
  ModerationFlag,
  ModerationFlagView,
  ModerationStats,
  ReportReason,
  ReportTarget,
} from '@internlink/shared-types';
import { Collections, db, firebaseAuth } from '../../config/firebase.js';
import { nowIso, serialise } from '../../lib/firestore.js';
import { conflict, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { consumeQuota } from '../../lib/daily-quota.js';
import type { ScamSeverity } from './scam-detection.js';

/**
 * FR-702/703 and §9.3 — everything reportable lands in one triage queue.
 *
 * A single queue rather than one per content type is the point: moderators work
 * a priority-ordered list, and scam/fraud outranks conduct regardless of
 * whether it arrived as a message, a listing or a post.
 */

const REASON_SEVERITY: Record<ReportReason, ModerationFlag['severity']> = {
  scam_or_fraud: 'critical',
  asks_for_payment: 'critical',
  impersonation: 'high',
  off_platform_data_request: 'high',
  harassment: 'high',
  discrimination: 'high',
  sexual_or_romantic: 'high',
  spam: 'normal',
  other: 'normal',
};

export async function createUserReport(args: {
  reporterId: string;
  targetType: ReportTarget;
  targetId: string;
  /** Parent document for subcollection targets — see `CreateReportSchema`. */
  parentId?: string | null | undefined;
  reason: ReportReason;
  detail?: string | undefined;
}): Promise<ModerationFlag> {
  await consumeQuota(args.reporterId, 'report');

  const flag: Omit<ModerationFlag, 'id'> = {
    targetType: args.targetType,
    targetId: args.targetId,
    parentId: args.parentId ?? null,
    reason: args.reason,
    detail: args.detail?.trim() || null,
    reportedBy: args.reporterId,
    source: 'user_report',
    severity: REASON_SEVERITY[args.reason],
    status: 'open',
    matchedRules: [],
    reviewedBy: null,
    reviewedAt: null,
    createdAt: nowIso(),
  };

  const ref = await db().collection(Collections.moderationFlags).add(flag);
  logger.info(
    { flagId: ref.id, targetType: args.targetType, reason: args.reason },
    'User report filed',
  );
  return { id: ref.id, ...flag };
}

/**
 * FR-1101 — raised by the auto-flagger, not by a person.
 *
 * Fire-and-forget by design: a moderation write must never be what stops a
 * message from sending. If this throws, the message still goes and we lose the
 * flag — which is the correct trade, because the alternative is an outage in
 * the moderation collection taking messaging down with it.
 */
export async function autoFlag(args: {
  targetType: ReportTarget;
  targetId: string;
  severity: ScamSeverity;
  matchedRules: string[];
  labels: string[];
  authorId: string;
}): Promise<void> {
  try {
    const flag: Omit<ModerationFlag, 'id'> = {
      targetType: args.targetType,
      targetId: args.targetId,
      parentId: null,
      reason: args.severity === 'critical' ? 'scam_or_fraud' : 'other',
      detail: args.labels.join('; ').slice(0, 1000),
      reportedBy: null,
      source: 'auto_flag',
      severity: args.severity,
      status: 'open',
      matchedRules: args.matchedRules,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: nowIso(),
    };

    await db().collection(Collections.moderationFlags).add(flag);
    logger.warn(
      {
        targetType: args.targetType,
        targetId: args.targetId,
        authorId: args.authorId,
        rules: args.matchedRules,
        severity: args.severity,
      },
      'Content auto-flagged',
    );
  } catch (error) {
    logger.error({ err: error, targetId: args.targetId }, 'Auto-flag write failed');
  }
}

/* ========================================================= admin console == */

/**
 * Attaches the reported content to each queue entry.
 *
 * Grouped by target type so one query serves every flag of a kind, rather than
 * one read per row. Content that has since been deleted resolves to `null` and
 * the moderator sees "no longer available" — which is itself a useful signal,
 * usually meaning the author removed it after being reported.
 */
export async function loadTargets(flags: ModerationFlag[]): Promise<ModerationFlagView[]> {
  const byType = new Map<ReportTarget, string[]>();
  for (const flag of flags) {
    byType.set(flag.targetType, [...(byType.get(flag.targetType) ?? []), flag.targetId]);
  }

  const targets = new Map<string, ModerationFlagView['target']>();

  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const collection = TARGET_COLLECTIONS[type];
      if (!collection) return;

      const unique = [...new Set(ids)];
      for (let i = 0; i < unique.length; i += 30) {
        const chunk = unique.slice(i, i + 30);
        const snap = await db().collection(collection).where('__name__', 'in', chunk).get();

        for (const doc of snap.docs) {
          targets.set(`${type}:${doc.id}`, summariseTarget(type, doc.id, doc.data()));
        }
      }
    }),
  );

  // Comments live under their post, so they cannot be fetched by ID alone and
  // are read one at a time using the `parentId` recorded on the flag. Bounded
  // by the number of comment reports on one page of the queue, which is small.
  await Promise.all(
    flags
      .filter((flag) => flag.targetType === 'comment' && flag.parentId)
      .map(async (flag) => {
        try {
          const snap = await db()
            .collection(Collections.posts)
            .doc(flag.parentId!)
            .collection(Collections.comments)
            .doc(flag.targetId)
            .get();
          if (snap.exists) {
            targets.set(
              `comment:${flag.targetId}`,
              summariseTarget('comment', flag.targetId, snap.data() ?? {}),
            );
          }
        } catch (error) {
          logger.warn({ err: error, flagId: flag.id }, 'Reported comment not resolved');
        }
      }),
  );

  // Reporter names, so a pattern of one account filing everything is visible.
  const reporterIds = [...new Set(flags.map((f) => f.reportedBy).filter(Boolean))] as string[];
  const reporters = new Map<string, string>();
  for (let i = 0; i < reporterIds.length; i += 30) {
    const chunk = reporterIds.slice(i, i + 30);
    const snap = await db().collection(Collections.accounts).where('__name__', 'in', chunk).get();
    for (const doc of snap.docs) reporters.set(doc.id, (doc.data().displayName as string) ?? '');
  }

  return flags.map((flag) => ({
    flag,
    target: targets.get(`${flag.targetType}:${flag.targetId}`) ?? null,
    reporterName: flag.reportedBy ? (reporters.get(flag.reportedBy) ?? null) : null,
  }));
}

/** Message flags carry a subcollection path, so they are resolved separately. */
const TARGET_COLLECTIONS: Partial<Record<ReportTarget, string>> = {
  post: Collections.posts,
  listing: Collections.listings,
  profile: Collections.accounts,
  company: Collections.companies,
};

/**
 * Maps a reported document to what a moderator is shown.
 *
 * Exported for testing: it reads arbitrary Firestore documents, including ones
 * written before a field existed, and a moderator queue that throws on a
 * half-populated legacy row is a queue that stops being worked.
 */
export function summariseTarget(
  type: ReportTarget,
  id: string,
  data: FirebaseFirestore.DocumentData,
): ModerationFlagView['target'] {
  const clip = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.slice(0, max) : '';

  switch (type) {
    case 'post':
      return {
        kind: type,
        title: clip(data.author?.name, 200) || 'Post',
        body: clip(data.body, 2000),
        authorId: (data.authorAccountId as string) ?? null,
        authorName: clip(data.author?.name, 160) || null,
        mediaUrl: (data.media?.[0]?.url as string) ?? (data.mediaUrl as string) ?? null,
      };
    case 'comment':
      return {
        kind: type,
        title: clip(data.author?.name, 200) || 'Comment',
        body: clip(data.body, 2000),
        authorId: (data.authorAccountId as string) ?? null,
        authorName: clip(data.author?.name, 160) || null,
        mediaUrl: null,
      };
    case 'listing':
      return {
        kind: type,
        title: clip(data.title, 200) || 'Listing',
        body: clip(data.description, 2000),
        authorId: (data.companyId as string) ?? null,
        authorName: null,
        mediaUrl: null,
      };
    case 'profile':
      return {
        kind: type,
        title: clip(data.displayName, 200) || 'Account',
        body: clip(data.email, 2000),
        authorId: id,
        authorName: clip(data.displayName, 160) || null,
        mediaUrl: (data.photoUrl as string) ?? null,
      };
    case 'company':
      return {
        kind: type,
        title: clip(data.name, 200) || 'Company',
        body: clip(data.description, 2000),
        authorId: (data.ownerAccountId as string) ?? null,
        authorName: null,
        mediaUrl: (data.logoUrl as string) ?? null,
      };
    default:
      return null;
  }
}

/**
 * FR-1107 — applies a moderator decision and records it.
 *
 * Content removal and account status are the two levers. They are applied here
 * rather than left to a follow-up call so that the flag and its consequence
 * cannot diverge: a flag marked `actioned` whose action silently failed is
 * worse than one still sitting open.
 */
export async function resolveFlag(args: {
  flagId: string;
  moderatorId: string;
  action: ModerationAction;
  note?: string | undefined;
}): Promise<ModerationFlag> {
  const ref = db().collection(Collections.moderationFlags).doc(args.flagId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('That report');

  const flag = serialise<ModerationFlag>({ id: args.flagId, ...snap.data() });
  if (flag.status === 'actioned' || flag.status === 'dismissed') {
    throw conflict('That report has already been resolved.');
  }

  const reviewedAt = nowIso();
  const status = args.action === 'dismiss' ? 'dismissed' : 'actioned';

  if (args.action === 'remove_content') {
    await removeContent(flag);
  }

  const accountStatus = ACCOUNT_STATUS_FOR[args.action];
  if (accountStatus) {
    const accountId = await accountBehind(flag);
    if (accountId) {
      await db().collection(Collections.accounts).doc(accountId).update({
        status: accountStatus,
        updatedAt: reviewedAt,
      });
      // The status claim is what the auth middleware reads, so it has to move
      // with the document or a suspended user keeps working until token expiry.
      await syncStatusClaim(accountId, accountStatus);
    }
  }

  await ref.update({
    status,
    reviewedBy: args.moderatorId,
    reviewedAt,
    action: args.action,
    moderatorNote: args.note ?? null,
  });

  logger.warn(
    { flagId: args.flagId, action: args.action, moderatorId: args.moderatorId },
    'Moderation action applied',
  );

  return { ...flag, status, reviewedBy: args.moderatorId, reviewedAt };
}

/** The escalation ladder, as account states. `warn` changes nothing yet. */
const ACCOUNT_STATUS_FOR: Partial<Record<ModerationAction, 'restricted' | 'suspended' | 'banned'>> =
  {
    restrict_account: 'restricted',
    suspend_account: 'suspended',
    ban_account: 'banned',
  };

async function removeContent(flag: ModerationFlag): Promise<void> {
  const collection = TARGET_COLLECTIONS[flag.targetType];
  // Flagging rather than deleting: an appeal (FR-1108) needs the content to
  // still exist, and a moderator acting on a misread should be reversible.
  if (collection === Collections.posts) {
    await db().collection(collection).doc(flag.targetId).update({ isFlagged: true });
    return;
  }
  if (collection === Collections.listings) {
    await db().collection(collection).doc(flag.targetId).update({ status: 'closed' });
  }
}

async function accountBehind(flag: ModerationFlag): Promise<string | null> {
  if (flag.targetType === 'profile') return flag.targetId;

  const collection = TARGET_COLLECTIONS[flag.targetType];
  if (!collection) return null;

  const snap = await db().collection(collection).doc(flag.targetId).get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  return (data.authorAccountId as string) ?? (data.ownerAccountId as string) ?? null;
}

async function syncStatusClaim(accountId: string, status: string): Promise<void> {
  try {
    const user = await firebaseAuth().getUser(accountId);
    await firebaseAuth().setCustomUserClaims(accountId, {
      ...(user.customClaims ?? {}),
      status,
    });
    // Without this, an existing token keeps working until it expires — up to an
    // hour of a banned account continuing as normal.
    await firebaseAuth().revokeRefreshTokens(accountId);
  } catch (error) {
    logger.error({ err: error, accountId }, 'Could not sync status claim after moderation');
  }
}

export async function moderationStats(now = Date.now()): Promise<ModerationStats> {
  const [openSnap, actionedSnap] = await Promise.all([
    db()
      .collection(Collections.moderationFlags)
      .where('status', '==', 'open')
      .orderBy('severity', 'asc')
      .orderBy('createdAt', 'asc')
      .limit(200)
      .get(),
    db()
      .collection(Collections.moderationFlags)
      .where('status', '==', 'actioned')
      .orderBy('reviewedAt', 'desc')
      .limit(100)
      .get(),
  ]);

  const open = openSnap.docs.map((d) => serialise<ModerationFlag>({ id: d.id, ...d.data() }));
  const since = new Date(now - 86_400_000).toISOString();

  const oldest = open.reduce<number>((worst, flag) => {
    const age = (now - new Date(flag.createdAt).getTime()) / 3_600_000;
    return Number.isFinite(age) ? Math.max(worst, age) : worst;
  }, 0);

  return {
    open: open.length,
    critical: open.filter((f) => f.severity === 'critical').length,
    actionedToday: actionedSnap.docs.filter((d) => (d.data().reviewedAt as string) >= since).length,
    oldestOpenHours: Math.round(oldest * 10) / 10,
  };
}
