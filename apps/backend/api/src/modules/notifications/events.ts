import { Collections, db } from '../../config/firebase.js';
import { nowIso } from '../../lib/firestore.js';
import { logger } from '../../lib/logger.js';

/**
 * FR-601 — every notification-triggering event is emitted here.
 *
 * The SRS (§3.1) has a separate notifications service consuming an event bus.
 * That service does not exist yet, so this writes the event to Firestore and
 * stops. A Cloud Functions trigger on this collection is the intended consumer,
 * which is why the shape is a durable document rather than an in-process
 * callback: when the consumer is built, nothing on this side changes.
 *
 * Emission never throws. A notification is not worth failing the action that
 * caused it — a message that sends but does not push is a far better outcome
 * than a message that refuses to send because the push queue is down.
 */

export type NotificationType =
  | 'message_received'
  | 'message_request'
  | 'connection_request'
  | 'connection_accepted'
  | 'application_status_changed'
  | 'application_received'
  | 'interview_scheduled'
  | 'post_reaction'
  | 'post_comment'
  | 'post_reshare'
  | 'comment_reaction'
  | 'new_follower'
  | 'new_post_from_following'
  | 'reengagement'
  | 'company_verified'
  | 'listing_match';

/**
 * FR-604 — urgent events skip digest batching entirely.
 *
 * "Your interview is in an hour" is worthless in tomorrow's digest, so the
 * decision is made at emission time by the code that has the context, not
 * later by a consumer trying to infer it from the type.
 */
const ALWAYS_URGENT: ReadonlySet<NotificationType> = new Set([
  'interview_scheduled',
  'application_status_changed',
  'company_verified',
]);

export interface EmitArgs {
  accountId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  urgent?: boolean;
  /** FR-503/509 — set for muted threads: record it, do not push it. */
  suppressPush?: boolean;
}

export async function emit(args: EmitArgs): Promise<void> {
  try {
    const urgent = args.urgent ?? ALWAYS_URGENT.has(args.type);

    await db()
      .collection(Collections.notifications)
      .add({
        accountId: args.accountId,
        type: args.type,
        payload: args.payload,
        urgent,
        suppressPush: args.suppressPush ?? false,
        // FR-603 — the digest job claims batchable events by this flag.
        channelsSent: [],
        deliveryState: urgent ? 'pending_immediate' : 'pending_batch',
        readAt: null,
        createdAt: nowIso(),
      });
  } catch (error) {
    logger.error(
      { err: error, type: args.type, accountId: args.accountId },
      'Notification emit failed — the originating action still succeeded',
    );
  }
}

/** Convenience for events that fan out to several people at once. */
export async function emitMany(
  accountIds: string[],
  args: Omit<EmitArgs, 'accountId'>,
): Promise<void> {
  await Promise.all(accountIds.map((accountId) => emit({ ...args, accountId })));
}
