import { z } from 'zod';
import { ActiveRoleSchema, ConnectionStatusSchema } from './enums.js';
import {
  CertificationSchema,
  EducationEntrySchema,
  ExperienceEntrySchema,
  IdSchema,
  IsoDateSchema,
  PortfolioLinkSchema,
} from './entities.js';

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

/**
 * FR-1006 — following is one-directional and needs no approval.
 *
 * Follows apply to people as well as companies. Connecting is a mutual,
 * approval-gated relationship that also unlocks messaging; following is the
 * lightweight "show me their posts" alternative, and wanting the second without
 * asking for the first is the common case.
 */
export const FollowTargetSchema = z.enum(['company', 'account']);
export type FollowTarget = z.infer<typeof FollowTargetSchema>;

export const FollowSchema = z.object({
  id: IdSchema,
  followerId: IdSchema,
  targetType: FollowTargetSchema,
  targetId: IdSchema,
  /**
   * Mirrors `targetId` on company follows only.
   *
   * Documents written before follows were generalised have `companyId` and no
   * `targetType`, and the reader backfills both from it. Keeping the field
   * written means a rollback does not strand the rows created since.
   */
  companyId: IdSchema.nullable(),
  createdAt: IsoDateSchema,
});
export type Follow = z.infer<typeof FollowSchema>;

export const FollowCountsSchema = z.object({
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
});
export type FollowCounts = z.infer<typeof FollowCountsSchema>;

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

/* ---------------------------------------------------------------- media --- */

export const PostMediaKindSchema = z.enum(['image', 'video']);
export type PostMediaKind = z.infer<typeof PostMediaKindSchema>;

/**
 * One item in a post's carousel.
 *
 * Dimensions are carried rather than measured on load: without them the feed
 * reflows as each image decodes, which on a phone means the post you were
 * reading jumps out from under your thumb. `thumbnailUrl` is a video's poster
 * frame — a muted autoplaying video still needs something to show in the frame
 * before it has buffered.
 */
export const PostMediaSchema = z.object({
  kind: PostMediaKindSchema,
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable().default(null),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  durationSeconds: z.number().nonnegative().nullable().default(null),
});
export type PostMedia = z.infer<typeof PostMediaSchema>;

/** Carousel cap. Past ten, swiping stops being browsing and starts being work. */
export const MAX_POST_MEDIA = 10;

/* -------------------------------------------------------------- resharing - */

/**
 * The snapshot a reshare carries of the post it quotes.
 *
 * Denormalised for the same reason `PostAuthor` is: a feed of reshares would
 * otherwise fetch one extra document each. It also means deleting the original
 * leaves existing reshares readable rather than turning them into blank cards.
 */
export const ResharedPostSchema = z.object({
  postId: IdSchema,
  author: PostAuthorSchema,
  authorAccountId: IdSchema,
  body: z.string().max(3000),
  media: z.array(PostMediaSchema).max(MAX_POST_MEDIA),
  createdAt: IsoDateSchema,
});
export type ResharedPost = z.infer<typeof ResharedPostSchema>;

export const PostSchema = z.object({
  id: IdSchema,
  author: PostAuthorSchema,
  /** The account that actually wrote it, even when posting as a company. */
  authorAccountId: IdSchema,
  companyId: IdSchema.nullable(),
  kind: PostKindSchema,
  body: z.string().max(3000),
  /**
   * Legacy single-image field, kept so posts written before carousels still
   * render. New posts write `media` and leave this as the first image.
   */
  mediaUrl: z.string().url().nullable(),
  media: z.array(PostMediaSchema).max(MAX_POST_MEDIA).default([]),
  linkUrl: z.string().url().nullable(),
  /** Set when `kind: 'hiring'` — lets the feed render a role card inline. */
  listingId: IdSchema.nullable(),
  tags: z.array(z.string().max(48)).max(8),
  reactionCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  shareCount: z.number().int().nonnegative().default(0),
  /** FR-1007 — the author decides whether their post can travel. */
  allowResharing: z.boolean().default(true),
  resharedFrom: ResharedPostSchema.nullable().default(null),
  isFlagged: z.boolean(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Post = z.infer<typeof PostSchema>;

export const CreatePostSchema = z
  .object({
    kind: PostKindSchema.default('update'),
    body: z.string().trim().max(3000, 'Keep it under 3,000 characters').default(''),
    mediaUrl: z.string().url().nullable().optional(),
    media: z.array(PostMediaSchema).max(MAX_POST_MEDIA).default([]),
    linkUrl: z.string().url('Enter a full URL, including https://').nullable().optional(),
    listingId: IdSchema.nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(48)).max(8).default([]),
    /** Post as the company rather than as yourself. Recruiters/owners only. */
    asCompany: z.boolean().default(false),
    allowResharing: z.boolean().default(true),
  })
  // A post needs *something* in it, but a photo with no caption is a perfectly
  // ordinary post — so the old `body.min(1)` is a rule about the post, not about
  // the text field.
  .refine((input) => input.body.length > 0 || input.media.length > 0 || Boolean(input.mediaUrl), {
    message: 'Write something or add a photo or video',
    path: ['body'],
  });
export type CreatePostInput = z.infer<typeof CreatePostSchema>;

/** The author-only controls on an existing post. */
export const UpdatePostSchema = z.object({
  allowResharing: z.boolean(),
});
export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;

/** An optional comment on top of the quoted post — an empty reshare is fine. */
export const ResharePostSchema = z.object({
  body: z.string().trim().max(3000, 'Keep it under 3,000 characters').default(''),
  asCompany: z.boolean().default(false),
});
export type ResharePostInput = z.infer<typeof ResharePostSchema>;

export const PostCommentSchema = z.object({
  id: IdSchema,
  postId: IdSchema,
  author: PostAuthorSchema,
  authorAccountId: IdSchema,
  body: z.string().max(1500),
  /**
   * Null on a top-level comment, the parent's ID on a reply.
   *
   * Replies are deliberately one level deep. Arbitrary nesting needs a tree
   * renderer, indentation that survives a 375px screen, and a "continue this
   * thread" affordance — and on a feed like this the third level is nearly
   * always someone replying to the second. A reply to a reply attaches to the
   * same parent instead, which is what Instagram and LinkedIn both do.
   */
  parentCommentId: IdSchema.nullable().default(null),
  likeCount: z.number().int().nonnegative().default(0),
  replyCount: z.number().int().nonnegative().default(0),
  createdAt: IsoDateSchema,
});
export type PostComment = z.infer<typeof PostCommentSchema>;

/** A comment as the viewer sees it — their own like state resolved server-side. */
export const PostCommentViewSchema = PostCommentSchema.extend({
  hasLiked: z.boolean(),
});
export type PostCommentView = z.infer<typeof PostCommentViewSchema>;

/** One top-level comment with its replies already attached. */
export const PostCommentThreadSchema = PostCommentViewSchema.extend({
  replies: z.array(PostCommentViewSchema).default([]),
});
export type PostCommentThread = z.infer<typeof PostCommentThreadSchema>;

export const CreateCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment first').max(1500),
  /** Replying to a reply attaches to its parent — see `parentCommentId`. */
  parentCommentId: IdSchema.nullable().optional(),
});
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;

/* ====================================================== People & profiles = */

/**
 * The redacted view of another account.
 *
 * Never derived from the raw `Account` document, which carries email, status
 * and verification internals. Everything here is safe to hand to any signed-in
 * viewer, and the viewer-relative fields (`relationship`, `isFollowing`) are
 * resolved server-side so the client never has to ask a second time to know
 * which button to draw.
 */
export const PersonSummarySchema = z.object({
  id: IdSchema,
  displayName: z.string().max(140),
  photoUrl: z.string().url().nullable(),
  headline: z.string().max(160).nullable(),
  activeRole: ActiveRoleSchema,
  isVerified: z.boolean(),
  companyName: z.string().max(160).nullable(),
  location: z.string().max(120).nullable(),
  relationship: RelationshipSchema,
  isFollowing: z.boolean(),
  /** Present when a request is outstanding either way — the ID to respond to. */
  connectionId: IdSchema.nullable(),
  mutualConnections: z.number().int().nonnegative(),
});
export type PersonSummary = z.infer<typeof PersonSummarySchema>;

export const PeopleQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  /** `suggested` ranks by mutual connections; `all` is a plain directory. */
  scope: z.enum(['suggested', 'all']).default('suggested'),
});
export type PeopleQuery = z.infer<typeof PeopleQuerySchema>;

export const ProfileStatsSchema = z.object({
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  connections: z.number().int().nonnegative(),
  posts: z.number().int().nonnegative(),
});
export type ProfileStats = z.infer<typeof ProfileStatsSchema>;

/** The subset of an intern profile another person may read (FR-1105). */
export const PublicInternProfileSchema = z.object({
  about: z.string().max(2600).nullable(),
  school: z.string().max(160).nullable(),
  location: z.string().max(120).nullable(),
  skills: z.array(z.string().max(48)),
  education: z.array(EducationEntrySchema),
  experience: z.array(ExperienceEntrySchema),
  certifications: z.array(CertificationSchema),
  portfolioLinks: z.array(PortfolioLinkSchema),
});
export type PublicInternProfile = z.infer<typeof PublicInternProfileSchema>;

export const PublicProfileSchema = z.object({
  person: PersonSummarySchema,
  /**
   * Null when FR-1105 visibility hides it from this viewer. The header still
   * renders — a profile that 404s because it is connections-only is
   * indistinguishable from one that does not exist, and that makes connecting
   * with someone you just met impossible.
   */
  profile: PublicInternProfileSchema.nullable(),
  /** Why `profile` is null, so the UI can say so rather than look broken. */
  profileHiddenReason: z.enum(['connections_only', 'recruiters_only']).nullable(),
  company: z
    .object({
      id: IdSchema,
      name: z.string(),
      logoUrl: z.string().url().nullable(),
      isVerified: z.boolean(),
    })
    .nullable(),
  stats: ProfileStatsSchema,
  joinedAt: IsoDateSchema,
});
export type PublicProfile = z.infer<typeof PublicProfileSchema>;

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
