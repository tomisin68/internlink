import { z } from 'zod';
import { ConnectionStatusSchema } from './enums.js';
import { IdSchema, IsoDateSchema } from './entities.js';

/* ========================================================== Connections === */

/**
 * FR-1006 — mutual connections between accounts.
 *
 * Stored with a deterministic ID (`sorted(a,b).join('_')`) so a connection is
 * unique by construction. Two people hitting "connect" on each other at the
 * same moment write the same document rather than creating a mirrored pair
 * that then has to be reconciled.
 */
export const ConnectionRecordSchema = z.object({
  id: IdSchema,
  requesterId: IdSchema,
  recipientId: IdSchema,
  /** Denormalised for `array-contains` queries — Firestore cannot OR two fields. */
  participantIds: z.array(IdSchema).length(2),
  status: ConnectionStatusSchema,
  message: z.string().max(300).nullable(),
  createdAt: IsoDateSchema,
  respondedAt: IsoDateSchema.nullable(),
});
export type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>;

export const SendConnectionRequestSchema = z.object({
  recipientId: IdSchema,
  message: z.string().trim().max(300).optional(),
});
export type SendConnectionRequestInput = z.infer<typeof SendConnectionRequestSchema>;

export const RespondToConnectionSchema = z.object({
  accept: z.boolean(),
});
export type RespondToConnectionInput = z.infer<typeof RespondToConnectionSchema>;

/** FR-1006 — following a company is one-directional and needs no approval. */
export const FollowSchema = z.object({
  id: IdSchema,
  followerId: IdSchema,
  companyId: IdSchema,
  createdAt: IsoDateSchema,
});
export type Follow = z.infer<typeof FollowSchema>;

/** How two accounts relate. Drives both messaging gates and feed affinity. */
export const RelationshipSchema = z.enum([
  'self',
  'connected',
  'pending_outgoing',
  'pending_incoming',
  'second_degree',
  'none',
  'blocked',
]);
export type Relationship = z.infer<typeof RelationshipSchema>;

/* ================================================================ Blocks == */

export const BlockSchema = z.object({
  id: IdSchema,
  blockerId: IdSchema,
  blockedId: IdSchema,
  createdAt: IsoDateSchema,
});
export type Block = z.infer<typeof BlockSchema>;

/* ================================================================= Posts == */

export const PostAuthorKindSchema = z.enum(['account', 'company']);
export type PostAuthorKind = z.infer<typeof PostAuthorKindSchema>;

/**
 * FR-1007 — feed content from companies (updates, hiring announcements) and
 * interns (achievements, certifications, projects).
 */
export const PostKindSchema = z.enum([
  'update',
  'achievement',
  'project',
  'certification',
  'hiring',
  'event',
]);
export type PostKind = z.infer<typeof PostKindSchema>;

/**
 * Author identity is denormalised onto every post.
 *
 * A feed page renders 20 posts from up to 20 different authors; without this
 * the read amplifies into 20 extra document fetches. The cost is that a name or
 * avatar change needs a backfill — acceptable, because those change rarely and
 * a slightly stale avatar is a much smaller problem than a feed that takes two
 * seconds to assemble.
 */
export const PostAuthorSchema = z.object({
  kind: PostAuthorKindSchema,
  id: IdSchema,
  name: z.string().max(160),
  avatarUrl: z.string().url().nullable(),
  headline: z.string().max(160).nullable(),
  isVerified: z.boolean(),
});
export type PostAuthor = z.infer<typeof PostAuthorSchema>;

export const PostSchema = z.object({
  id: IdSchema,
  author: PostAuthorSchema,
  /** The account that actually wrote it, even when posting as a company. */
  authorAccountId: IdSchema,
  companyId: IdSchema.nullable(),
  kind: PostKindSchema,
  body: z.string().max(3000),
  mediaUrl: z.string().url().nullable(),
  linkUrl: z.string().url().nullable(),
  /** Set when `kind: 'hiring'` — lets the feed render a role card inline. */
  listingId: IdSchema.nullable(),
  tags: z.array(z.string().max(48)).max(8),
  reactionCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  isFlagged: z.boolean(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Post = z.infer<typeof PostSchema>;

export const CreatePostSchema = z.object({
  kind: PostKindSchema.default('update'),
  body: z
    .string()
    .trim()
    .min(1, 'Write something first')
    .max(3000, 'Keep it under 3,000 characters'),
  mediaUrl: z.string().url().nullable().optional(),
  linkUrl: z.string().url('Enter a full URL, including https://').nullable().optional(),
  listingId: IdSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(48)).max(8).default([]),
  /** Post as the company rather than as yourself. Recruiters/owners only. */
  asCompany: z.boolean().default(false),
});
export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export const PostCommentSchema = z.object({
  id: IdSchema,
  postId: IdSchema,
  author: PostAuthorSchema,
  authorAccountId: IdSchema,
  body: z.string().max(1500),
  createdAt: IsoDateSchema,
});
export type PostComment = z.infer<typeof PostCommentSchema>;

export const CreateCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment first').max(1500),
});
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

/* ======================================================== Moderation ====== */

export const ReportTargetSchema = z.enum(['listing', 'message', 'post', 'profile', 'company']);
export type ReportTarget = z.infer<typeof ReportTargetSchema>;

/** §9.3 — severity decides queue position; scam/fraud outranks conduct. */
export const ReportReasonSchema = z.enum([
  'scam_or_fraud',
  'asks_for_payment',
  'impersonation',
  'harassment',
  'discrimination',
  'sexual_or_romantic',
  'spam',
  'off_platform_data_request',
  'other',
]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const CreateReportSchema = z.object({
  targetType: ReportTargetSchema,
  targetId: IdSchema,
  reason: ReportReasonSchema,
  detail: z.string().trim().max(1000).optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportSchema>;

export const ModerationFlagSchema = z.object({
  id: IdSchema,
  targetType: ReportTargetSchema,
  targetId: IdSchema,
  reason: ReportReasonSchema,
  detail: z.string().max(1000).nullable(),
  /** Null when raised by the auto-flagger rather than a person (FR-1101). */
  reportedBy: IdSchema.nullable(),
  source: z.enum(['user_report', 'auto_flag']),
  severity: z.enum(['critical', 'high', 'normal']),
  status: z.enum(['open', 'reviewing', 'actioned', 'dismissed']),
  matchedRules: z.array(z.string()).default([]),
  reviewedBy: IdSchema.nullable(),
  reviewedAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
});
export type ModerationFlag = z.infer<typeof ModerationFlagSchema>;
