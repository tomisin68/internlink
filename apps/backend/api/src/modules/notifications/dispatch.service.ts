import type { Account } from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { serialise } from '../../lib/firestore.js';
import { logger } from '../../lib/logger.js';
import { sendToAccounts, type PushPayload } from './push.service.js';
import type { NotificationType } from './events.js';

/**
 * Pushes social events to a device as they happen.
 *
 * Until now only two event types ever reached a phone: "someone you follow
 * posted" and the re-engagement sweep. Everything else — a like, a comment, a
 * new follower, a tag — wrote a durable row that the user only discovered by
 * opening the app, which is the opposite of what a notification is for and the
 * reason the bell felt like it did nothing.
 *
 * The digest job (FR-603) is still the batching path for anything low-value.
 * These are the events people expect *immediately*, and delaying them to a
 * nightly email is the same as dropping them.
 *
 * Nothing here throws. A push that fails must never take down the action that
 * caused it — the durable notification is already written by the time this
 * runs, so the in-app bell is correct regardless.
 */

/**
 * Copy per event type, as a function of who did it and what they did it to.
 *
 * `null` means "durable only, never push" — the honest answer for events that
 * are worth finding later but not worth interrupting someone for.
 */
type Composer = (context: {
  actorName: string;
  preview: string;
  payload: Record<string, unknown>;
}) => Omit<PushPayload, 'path'> & { path: string };

const COMPOSERS: Partial<Record<NotificationType, Composer>> = {
  post_reaction: ({ actorName, preview, payload }) => ({
    title: `${actorName} liked your post`,
    body: preview || 'Open to see it.',
    path: `/p/${payload.postId as string}`,
    tag: `reaction:${payload.postId as string}`,
  }),
  post_comment: ({ actorName, preview, payload }) => ({
    title: payload.isReply
      ? `${actorName} replied to your comment`
      : `${actorName} commented on your post`,
    body: preview || 'Open to read it.',
    path: `/p/${payload.postId as string}`,
    tag: `comment:${payload.postId as string}`,
  }),
  comment_reaction: ({ actorName, payload }) => ({
    title: `${actorName} liked your comment`,
    body: 'Open the thread to see it.',
    path: `/p/${payload.postId as string}`,
    tag: `comment-like:${payload.commentId as string}`,
  }),
  post_reshare: ({ actorName, preview, payload }) => ({
    title: `${actorName} reshared your post`,
    body: preview || 'It is now in their followers’ feeds.',
    path: `/p/${payload.postId as string}`,
    tag: `reshare:${payload.postId as string}`,
  }),
  mention: ({ actorName, preview, payload }) => ({
    title: `${actorName} tagged you`,
    body: preview || 'Open to see where.',
    path: payload.postId ? `/p/${payload.postId as string}` : '/notifications',
    tag: `mention:${(payload.commentId as string) ?? (payload.postId as string)}`,
  }),
  new_follower: ({ actorName, payload }) => ({
    title: `${actorName} started following you`,
    body: 'Follow them back to see their posts.',
    path: `/u/${payload.byAccountId as string}`,
    tag: `follower:${payload.byAccountId as string}`,
  }),
  follow_back: ({ actorName, payload }) => ({
    title: `${actorName} followed you back`,
    body: 'You will both see each other’s posts now.',
    path: `/u/${payload.byAccountId as string}`,
    tag: `follow-back:${payload.byAccountId as string}`,
  }),
  connection_request: ({ actorName }) => ({
    title: `${actorName} wants to connect`,
    body: 'Open your requests to respond.',
    path: '/network',
    tag: 'connection-request',
  }),
  connection_accepted: ({ actorName }) => ({
    title: `${actorName} accepted your request`,
    body: 'You can message each other now.',
    path: '/network',
    tag: 'connection-accepted',
  }),
  message_received: ({ actorName, preview, payload }) => ({
    title: `${actorName} sent you a message`,
    body: preview || 'Open the conversation.',
    path: `/messages/${payload.threadId as string}`,
    tag: `thread:${payload.threadId as string}`,
  }),
  message_request: ({ actorName, payload }) => ({
    title: `${actorName} sent a message request`,
    body: 'Accept it to start the conversation.',
    path: `/messages/${payload.threadId as string}`,
    tag: `thread:${payload.threadId as string}`,
  }),
  application_received: ({ actorName, preview }) => ({
    title: 'New applicant',
    body: preview ? `${actorName} applied to ${preview}.` : `${actorName} applied to your role.`,
    path: '/applications',
    tag: 'application-received',
  }),
  application_status_changed: ({ preview }) => ({
    title: 'An application moved forward',
    body: preview || 'Open your applications to see where it stands.',
    path: '/applications',
    tag: 'application-status',
  }),
  interview_scheduled: ({ preview }) => ({
    title: 'Interview scheduled',
    body: preview || 'Check your applications for the details.',
    path: '/applications',
    tag: 'interview',
  }),

  // Deliberately durable-only. A profile view is interesting to scroll past and
  // insufferable as a buzz in your pocket, and it is the single fastest way to
  // get someone to turn notifications off for good.
  profile_view: undefined,
};

async function actorNameFor(accountId: string | null): Promise<string> {
  if (!accountId) return 'Someone';
  try {
    const snap = await db().collection(Collections.accounts).doc(accountId).get();
    if (!snap.exists) return 'Someone';
    const account = serialise<Account>({ id: snap.id, ...snap.data() });
    return account.displayName || `${account.firstName} ${account.lastName}`.trim() || 'Someone';
  } catch {
    return 'Someone';
  }
}

/**
 * Sends the push for one already-persisted notification. Never throws.
 *
 * `suppressPush` is honoured here rather than at the call site so a muted
 * thread (FR-503/509) stays muted no matter which code path emitted the event.
 */
export async function dispatchPush(args: {
  accountId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  suppressPush?: boolean;
}): Promise<void> {
  if (args.suppressPush) return;

  const compose = COMPOSERS[args.type];
  if (!compose) return;

  try {
    const actorId =
      (args.payload.byAccountId as string | undefined) ??
      (args.payload.fromAccountId as string | undefined) ??
      null;

    const payload = compose({
      actorName: await actorNameFor(actorId),
      preview: typeof args.payload.preview === 'string' ? args.payload.preview : '',
      payload: args.payload,
    });

    await sendToAccounts([args.accountId], payload);
  } catch (error) {
    logger.warn(
      { err: error, type: args.type, accountId: args.accountId },
      'Push dispatch failed — the notification is still in the bell',
    );
  }
}
