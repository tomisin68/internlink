import type { ModerationFlag, ReportReason, ReportTarget } from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { nowIso } from '../../lib/firestore.js';
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
  reason: ReportReason;
  detail?: string | undefined;
}): Promise<ModerationFlag> {
  await consumeQuota(args.reporterId, 'report');

  const flag: Omit<ModerationFlag, 'id'> = {
    targetType: args.targetType,
    targetId: args.targetId,
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
