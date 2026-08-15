import { z } from 'zod';
import { IdSchema, IsoDateSchema } from './entities.js';

/* ============================================================== Threads === */

export const ThreadKindSchema = z.enum([
  /** 1:1 between two accounts. */
  'direct',
  /** FR-508 — community/group discussion, distinct from 1:1. */
  'group',
]);
export type ThreadKind = z.infer<typeof ThreadKindSchema>;

/**
 * FR-505/506 — a thread is either a real conversation or a pending request.
 *
 * `request` threads live in a separate inbox and allow exactly one message from
 * the sender until the recipient accepts. That single-message cap is what makes
 * the "message request" meaningful: without it, a rejected sender could still
 * fill someone's request inbox with a monologue.
 */
export const ThreadStateSchema = z.enum(['request', 'accepted', 'declined', 'blocked']);
export type ThreadState = z.infer<typeof ThreadStateSchema>;

export const ThreadParticipantSchema = z.object({
  accountId: IdSchema,
  name: z.string().max(160),
  avatarUrl: z.string().url().nullable(),
  headline: z.string().max(160).nullable(),
});
export type ThreadParticipant = z.infer<typeof ThreadParticipantSchema>;

export const MessagePreviewSchema = z.object({
  body: z.string().max(240),
  senderId: IdSchema,
  sentAt: IsoDateSchema,
  hasAttachment: z.boolean(),
});

export const ThreadSchema = z.object({
  id: IdSchema,
  kind: ThreadKindSchema,
  state: ThreadStateSchema,
  /** Denormalised for `array-contains` — the only way to query "my threads". */
  participantIds: z.array(IdSchema).min(2),
  participants: z.array(ThreadParticipantSchema),
  /** Set when the thread was opened off the back of an application (§6). */
  applicationId: IdSchema.nullable(),
  listingId: IdSchema.nullable(),
  /** Group threads only. */
  title: z.string().max(120).nullable(),
  initiatedBy: IdSchema,
  lastMessage: MessagePreviewSchema.nullable(),
  /** Per-participant unread counts, keyed by account ID. */
  unread: z.record(z.string(), z.number().int().nonnegative()),
  /** Participants who have muted this thread — no push, still in the list. */
  mutedBy: z.array(IdSchema).default([]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Thread = z.infer<typeof ThreadSchema>;

/* ============================================================= Messages === */

export const AttachmentSchema = z.object({
  url: z.string().url(),
  name: z.string().max(200),
  mimeType: z.string().max(120),
  bytes: z.number().int().nonnegative(),
  kind: z.enum(['image', 'file']),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const MessageSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  senderId: IdSchema,
  body: z.string().max(4000),
  attachments: z.array(AttachmentSchema).max(5),
  /** FR-507 — accounts that have read this message. */
  readBy: z.array(IdSchema).default([]),
  /** FR-1101 — set by the auto-flagger; the message still sends. */
  isFlagged: z.boolean().default(false),
  flagReasons: z.array(z.string()).default([]),
  editedAt: IsoDateSchema.nullable(),
  deletedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
});
export type Message = z.infer<typeof MessageSchema>;

export const SendMessageSchema = z
  .object({
    body: z.string().trim().max(4000).default(''),
    attachments: z
      .array(
        z.object({
          url: z.string().url(),
          name: z.string().max(200),
          mimeType: z.string().max(120),
          bytes: z.number().int().nonnegative(),
          kind: z.enum(['image', 'file']),
        }),
      )
      .max(5)
      .default([]),
  })
  // An empty body is fine when there is a file, and vice versa — but not both
  // empty, which is what an accidental Enter keypress produces.
  .refine((v) => v.body.length > 0 || v.attachments.length > 0, {
    message: 'Write a message or attach a file',
    path: ['body'],
  });
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

/** Opens a thread with someone, or returns the existing one. */
export const StartThreadSchema = z.object({
  recipientId: IdSchema,
  body: z.string().trim().min(1, 'Write a message first').max(4000),
  applicationId: IdSchema.nullable().optional(),
  listingId: IdSchema.nullable().optional(),
});
export type StartThreadInput = z.infer<typeof StartThreadSchema>;

export const RespondToRequestSchema = z.object({
  accept: z.boolean(),
  /** Accepting is enough on its own; blocking is the hard "never again". */
  block: z.boolean().default(false),
});
export type RespondToRequestInput = z.infer<typeof RespondToRequestSchema>;

/**
 * FR-507 — typing indicators.
 *
 * Deliberately not persisted as documents. Writing a Firestore doc per
 * keystroke would be both slow and expensive; this is an ephemeral signal with
 * a short TTL, carried over the realtime channel only.
 */
export const TypingSignalSchema = z.object({
  threadId: IdSchema,
  accountId: IdSchema,
  expiresAt: IsoDateSchema,
});
export type TypingSignal = z.infer<typeof TypingSignalSchema>;

/** What the inbox badge needs, in one call. */
export const InboxSummarySchema = z.object({
  unreadThreads: z.number().int().nonnegative(),
  unreadMessages: z.number().int().nonnegative(),
  pendingRequests: z.number().int().nonnegative(),
});
export type InboxSummary = z.infer<typeof InboxSummarySchema>;
