import { FieldValue } from 'firebase-admin/firestore';
import type {
  Account,
  Attachment,
  InboxSummary,
  Message,
  MessageSticker,
  Paginated,
  ReplyPreview,
  Thread,
  ThreadParticipant,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { docToEntity, nowIso, serialise } from '../../lib/firestore.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { consumeQuota } from '../../lib/daily-quota.js';
import { getAccount } from '../auth/auth.service.js';
import { getInternProfile } from '../profiles/profiles.service.js';
import { getConnection, isBlockedEitherWay } from '../connections/connections.service.js';
import { scanForScamPatterns } from '../moderation/scam-detection.js';
import { autoFlag } from '../moderation/moderation.service.js';
import { resolveMentions } from '../posts/engagement.service.js';
import { emit } from '../notifications/events.js';

/** Deterministic for direct threads, so opening a conversation is idempotent. */
export function directThreadId(a: string, b: string): string {
  return [a, b].sort().join('__');
}

async function toParticipant(accountId: string): Promise<ThreadParticipant> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('That person');
  const profile = await getInternProfile(accountId).catch(() => null);

  return {
    accountId,
    name: account.displayName || `${account.firstName} ${account.lastName}`.trim(),
    avatarUrl: account.photoUrl,
    headline: profile?.headline ?? null,
  };
}

export async function getThread(threadId: string): Promise<Thread | null> {
  return docToEntity<Thread>(await db().collection(Collections.messageThreads).doc(threadId).get());
}

function assertParticipant(thread: Thread, accountId: string): void {
  if (!thread.participantIds.includes(accountId)) {
    // Not-found rather than forbidden: confirming a thread exists is itself a
    // leak about who is talking to whom.
    throw notFound('That conversation');
  }
}

/**
 * FR-505 — decides whether a new conversation opens freely or as a request.
 *
 * Free when the two are connected, or when an application already links them
 * (FR-501: an application is itself consent to be contacted about it).
 * Otherwise it opens as a `request`, which allows exactly one message until
 * accepted.
 */
async function resolveInitialState(
  senderId: string,
  recipientId: string,
  applicationId: string | null,
): Promise<'accepted' | 'request'> {
  const connection = await getConnection(senderId, recipientId);
  if (connection?.status === 'accepted') return 'accepted';

  if (applicationId) {
    const app = await db().collection(Collections.applications).doc(applicationId).get();
    const data = app.data();
    if (app.exists && (data?.internAccountId === senderId || data?.internAccountId === recipientId)) {
      return 'accepted';
    }
  }

  return 'request';
}

export interface StartThreadArgs {
  senderId: string;
  recipientId: string;
  body: string;
  applicationId?: string | null;
  listingId?: string | null;
}

export async function startThread(args: StartThreadArgs): Promise<{ thread: Thread; message: Message }> {
  const { senderId, recipientId } = args;
  if (senderId === recipientId) throw conflict('You cannot message yourself.');
  if (await isBlockedEitherWay(senderId, recipientId)) throw notFound('That person');

  const threadId = directThreadId(senderId, recipientId);
  const existing = await getThread(threadId);

  if (existing) {
    if (existing.state === 'blocked') throw notFound('That conversation');
    const message = await sendMessage({
      threadId,
      senderId,
      body: args.body,
      attachments: [],
    });
    return { thread: (await getThread(threadId))!, message };
  }

  const state = await resolveInitialState(senderId, recipientId, args.applicationId ?? null);

  // Only cold outreach burns quota. Messaging a connection, or replying about
  // an application, is not the behaviour FR-1102 is trying to cap.
  if (state === 'request') await consumeQuota(senderId, 'cold_message');

  const participants = await Promise.all([toParticipant(senderId), toParticipant(recipientId)]);
  const ts = nowIso();

  const thread: Omit<Thread, 'id'> = {
    kind: 'direct',
    state,
    participantIds: [senderId, recipientId].sort(),
    participants,
    applicationId: args.applicationId ?? null,
    listingId: args.listingId ?? null,
    title: null,
    initiatedBy: senderId,
    lastMessage: null,
    unread: { [senderId]: 0, [recipientId]: 0 },
    mutedBy: [],
    createdAt: ts,
    updatedAt: ts,
  };

  await db().collection(Collections.messageThreads).doc(threadId).set(thread);

  const message = await sendMessage({ threadId, senderId, body: args.body, attachments: [] });
  return { thread: { id: threadId, ...thread }, message };
}

export interface SendMessageArgs {
  threadId: string;
  senderId: string;
  body: string;
  attachments: Attachment[];
  sticker?: MessageSticker | null;
  replyToMessageId?: string | null;
}

/**
 * FR-502/506 — appends a message, enforcing the request cap.
 *
 * The single-message cap on a pending request is what makes "message request"
 * mean anything: without it, a sender the recipient has not accepted could
 * still fill their request inbox with a monologue.
 */
export async function sendMessage(args: SendMessageArgs): Promise<Message> {
  const { threadId, senderId } = args;
  const thread = await getThread(threadId);
  if (!thread) throw notFound('That conversation');
  assertParticipant(thread, senderId);

  if (thread.state === 'blocked') throw forbidden('You can no longer message in this conversation.');
  if (thread.state === 'declined') throw forbidden('This request was declined.');

  if (thread.state === 'request') {
    if (thread.initiatedBy !== senderId) {
      // The recipient replying is an implicit accept — no reason to make them
      // press a separate button first.
      await respondToRequest(senderId, threadId, true, false);
    } else {
      const sent = await db()
        .collection(Collections.messageThreads)
        .doc(threadId)
        .collection(Collections.messages)
        .where('senderId', '==', senderId)
        .limit(2)
        .get();

      if (!sent.empty) {
        throw conflict(
          'You have already sent a message request to this person. Wait for them to reply.',
        );
      }
    }
  }

  const scan = scanForScamPatterns(args.body);
  const mentions = await resolveMentions(senderId, args.body);
  const replyTo = args.replyToMessageId
    ? await buildReplyPreview(threadId, args.replyToMessageId)
    : null;
  const ts = nowIso();

  const message: Omit<Message, 'id'> = {
    threadId,
    senderId,
    body: args.body,
    mentions,
    attachments: args.attachments,
    sticker: args.sticker ?? null,
    replyTo,
    // The sender has trivially read their own message.
    readBy: [senderId],
    isFlagged: scan.isFlagged,
    flagReasons: scan.matchedRuleIds,
    editedAt: null,
    deletedAt: null,
    createdAt: ts,
  };

  const messageRef = await db()
    .collection(Collections.messageThreads)
    .doc(threadId)
    .collection(Collections.messages)
    .add(message);

  const recipients = thread.participantIds.filter((id) => id !== senderId);
  const unreadIncrements: Record<string, FieldValue> = {};
  for (const id of recipients) {
    unreadIncrements[`unread.${id}`] = FieldValue.increment(1);
  }

  const preview = messagePreview(args.body, args.attachments, args.sticker ?? null);

  await db()
    .collection(Collections.messageThreads)
    .doc(threadId)
    .update({
      ...unreadIncrements,
      lastMessage: {
        body: preview,
        senderId,
        sentAt: ts,
        hasAttachment: args.attachments.length > 0 || Boolean(args.sticker),
      },
      updatedAt: ts,
    });

  // The message is already durable at this point — moderation and notification
  // are deliberately after the write, and neither can fail the send.
  if (scan.isFlagged && scan.severity) {
    void autoFlag({
      targetType: 'message',
      targetId: messageRef.id,
      severity: scan.severity,
      matchedRules: scan.matchedRuleIds,
      labels: scan.labels,
      authorId: senderId,
    });
  }

  for (const recipientId of recipients) {
    void emit({
      accountId: recipientId,
      type: thread.state === 'request' ? 'message_request' : 'message_received',
      payload: {
        threadId,
        messageId: messageRef.id,
        senderId,
        byAccountId: senderId,
        preview: preview.slice(0, 160),
      },
      urgent: false,
      // FR-503 — muted threads stay in the list but stop pushing.
      suppressPush: thread.mutedBy.includes(recipientId),
    });
  }

  // Someone tagged in a message who is not in the thread hears about it once,
  // as a mention — they cannot read the thread, but "you were mentioned" is
  // still the honest thing to say. Participants already got the message itself.
  for (const mention of mentions) {
    if (mention.accountId === senderId || recipients.includes(mention.accountId)) continue;
    void emit({
      accountId: mention.accountId,
      type: 'mention',
      payload: { byAccountId: senderId, preview: args.body.slice(0, 160) },
    });
  }

  return { id: messageRef.id, ...message };
}

function messagePreview(
  body: string,
  attachments: Attachment[],
  sticker: MessageSticker | null,
): string {
  const trimmed = body.trim();
  if (trimmed) return trimmed.slice(0, 240);
  if (sticker) return `${sticker.emoji} ${sticker.label}`;
  const first = attachments[0];
  if (first?.kind === 'voice') return 'Voice note';
  if (first?.kind === 'image') return 'Image attachment';
  if (first) return first.name || 'Attachment';
  return '';
}

async function buildReplyPreview(
  threadId: string,
  messageId: string,
): Promise<ReplyPreview | null> {
  const snap = await db()
    .collection(Collections.messageThreads)
    .doc(threadId)
    .collection(Collections.messages)
    .doc(messageId)
    .get();

  if (!snap.exists) return null;
  const data = snap.data() as Partial<Message>;
  const attachments = (data.attachments ?? []) as Attachment[];
  const sticker = (data.sticker ?? null) as MessageSticker | null;

  return {
    messageId,
    senderId: data.senderId ?? '',
    body: messagePreview(data.body ?? '', attachments, sticker).slice(0, 180),
    attachmentKind: attachments[0]?.kind ?? null,
    sticker,
  };
}

/** FR-506 — accept, decline, or decline-and-block a pending request. */
export async function respondToRequest(
  accountId: string,
  threadId: string,
  accept: boolean,
  block: boolean,
): Promise<Thread> {
  const thread = await getThread(threadId);
  if (!thread) throw notFound('That conversation');
  assertParticipant(thread, accountId);

  if (thread.initiatedBy === accountId) {
    throw forbidden('You cannot respond to your own request.');
  }
  if (thread.state !== 'request') return thread;

  const state = block ? 'blocked' : accept ? 'accepted' : 'declined';
  const updatedAt = nowIso();
  await db().collection(Collections.messageThreads).doc(threadId).update({ state, updatedAt });

  if (block) {
    const { blockAccount } = await import('../connections/connections.service.js');
    await blockAccount(accountId, thread.initiatedBy);
  }

  return { ...thread, state, updatedAt };
}

/** FR-507 — marks everything in a thread read for this account. */
export async function markThreadRead(accountId: string, threadId: string): Promise<void> {
  const thread = await getThread(threadId);
  if (!thread) throw notFound('That conversation');
  assertParticipant(thread, accountId);

  const unreadSnap = await db()
    .collection(Collections.messageThreads)
    .doc(threadId)
    .collection(Collections.messages)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const batch = db().batch();
  for (const doc of unreadSnap.docs) {
    const readBy = (doc.data().readBy as string[]) ?? [];
    if (!readBy.includes(accountId)) {
      batch.update(doc.ref, { readBy: FieldValue.arrayUnion(accountId) });
    }
  }
  batch.update(db().collection(Collections.messageThreads).doc(threadId), {
    [`unread.${accountId}`]: 0,
  });

  await batch.commit();
}

/** FR-509 — mute keeps the thread visible but silences notifications. */
export async function setThreadMuted(
  accountId: string,
  threadId: string,
  muted: boolean,
): Promise<void> {
  const thread = await getThread(threadId);
  if (!thread) throw notFound('That conversation');
  assertParticipant(thread, accountId);

  await db()
    .collection(Collections.messageThreads)
    .doc(threadId)
    .update({
      mutedBy: muted ? FieldValue.arrayUnion(accountId) : FieldValue.arrayRemove(accountId),
      updatedAt: nowIso(),
    });
}

/**
 * FR-506 — the two inboxes are separate queries, not a client-side filter.
 *
 * Keeping requests out of the primary list is the whole feature; doing it in
 * the client would still ship the request bodies to a device that should not
 * be showing them alongside real conversations.
 */
export async function listThreads(
  accountId: string,
  box: 'primary' | 'requests',
  limit: number,
): Promise<Paginated<Thread>> {
  const snap = await db()
    .collection(Collections.messageThreads)
    .where('participantIds', 'array-contains', accountId)
    .where('state', '==', box === 'requests' ? 'request' : 'accepted')
    .orderBy('updatedAt', 'desc')
    .limit(limit + 1)
    .get();

  const docs = snap.docs.slice(0, limit);
  const threads = docs
    .map((d) => docToEntity<Thread>(d))
    .filter((t): t is Thread => Boolean(t))
    // Someone's own pending request belongs in their sent list, not their
    // request inbox — they should not be asked to accept themselves.
    .filter((t) => (box === 'requests' ? t.initiatedBy !== accountId : true));

  return {
    items: threads,
    nextCursor: null,
    hasMore: snap.docs.length > limit,
  };
}

export async function listMessages(
  accountId: string,
  threadId: string,
  limit: number,
  before?: string,
): Promise<Paginated<Message>> {
  const thread = await getThread(threadId);
  if (!thread) throw notFound('That conversation');
  assertParticipant(thread, accountId);

  let query = db()
    .collection(Collections.messageThreads)
    .doc(threadId)
    .collection(Collections.messages)
    .orderBy('createdAt', 'desc')
    .limit(limit + 1);

  if (before) query = query.startAfter(before);

  const snap = await query.get();
  const docs = snap.docs.slice(0, limit);

  return {
    items: docs.map((d) => serialise<Message>({ id: d.id, ...d.data() })).reverse(),
    nextCursor: docs.length > 0 ? (docs[docs.length - 1]!.data().createdAt as string) : null,
    hasMore: snap.docs.length > limit,
  };
}

export async function getInboxSummary(accountId: string): Promise<InboxSummary> {
  const [primary, requests] = await Promise.all([
    db()
      .collection(Collections.messageThreads)
      .where('participantIds', 'array-contains', accountId)
      .where('state', '==', 'accepted')
      .get(),
    db()
      .collection(Collections.messageThreads)
      .where('participantIds', 'array-contains', accountId)
      .where('state', '==', 'request')
      .get(),
  ]);

  let unreadThreads = 0;
  let unreadMessages = 0;
  for (const doc of primary.docs) {
    const count = ((doc.data().unread as Record<string, number>) ?? {})[accountId] ?? 0;
    if (count > 0) {
      unreadThreads += 1;
      unreadMessages += count;
    }
  }

  return {
    unreadThreads,
    unreadMessages,
    pendingRequests: requests.docs.filter((d) => d.data().initiatedBy !== accountId).length,
  };
}

export type { Account };
