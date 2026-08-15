import { z } from 'zod';
import { ActiveRoleSchema, ConnectionStatusSchema } from './enums.js';
import {
  CertificationSchema,
  CompanySchema,
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
/* ============================================================== Mentions == */

/**
 * FR-1007 — someone tagged in a post, a comment or a message.
 *
 * The display name is stored alongside the ID so the text can be re-rendered
 * without a lookup per mention, and so a mention survives the tagged person
 * changing their name mid-thread — the link still resolves, the label is simply
 * the name as it read when it was written.
 */
export const MentionSchema = z.object({
  accountId: IdSchema,
  displayName: z.string().min(1).max(140),
});
export type Mention = z.infer<typeof MentionSchema>;

/** Past this, a "mention" is a mailing list. */
export const MAX_MENTIONS = 10;

/**
 * Finds `@handle` runs in a body and resolves them against a candidate list.
 *
 * Shared rather than duplicated because both sides need the same answer: the
 * client highlights the text, the server decides who gets notified, and a
 * disagreement between the two shows up as a tag that renders but never
 * arrives. Matching is longest-name-first so "@Ada Lovelace" wins over "@Ada".
 */
export function extractMentions(
  body: string,
  candidates: ReadonlyArray<{ accountId: string; displayName: string }>,
): Mention[] {
  const found: Mention[] = [];
  const seen = new Set<string>();

  const ordered = [...candidates].sort((a, b) => b.displayName.length - a.displayName.length);
  const lower = body.toLowerCase();

  for (const candidate of ordered) {
    if (found.length >= MAX_MENTIONS) break;
    if (seen.has(candidate.accountId)) continue;
    const needle = `@${candidate.displayName.toLowerCase()}`;
    if (lower.includes(needle)) {
      seen.add(candidate.accountId);
      found.push({ accountId: candidate.accountId, displayName: candidate.displayName });
    }
  }

  return found;
}

/* ================================================================ Hashtags */

/** Cap on hashtags per post. Beyond this it is keyword stuffing, not topics. */
export const MAX_POST_TAGS = 12;

/**
 * Pulls `#hashtags` out of free text and normalises them.
 *
 * Lower-cased and stripped of the leading `#` so `#React` and `#react` are one
 * topic rather than two. Digits are allowed but a tag cannot be only digits —
 * "#2024" as a topic is noise, and it collides with every other year.
 */
export function extractHashtags(body: string): string[] {
  const matches = body.match(/#[\p{L}\p{N}_]{2,48}/gu) ?? [];
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    const tag = raw.slice(1).toLowerCase();
    if (/^\d+$/.test(tag) || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_POST_TAGS) break;
  }

  return tags;
}

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
  /** Hashtags, normalised and without the leading `#`. See `extractHashtags`. */
  tags: z.array(z.string().max(48)).max(MAX_POST_TAGS),
  /** People tagged in the body — see `MentionSchema`. */
  mentions: z.array(MentionSchema).max(MAX_MENTIONS).default([]),
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
    /**
     * Explicit hashtags. Anything typed as `#tag` in the body is merged in
     * server-side, so a client that only offers inline hashtags still works.
     */
    tags: z.array(z.string().trim().min(1).max(48)).max(MAX_POST_TAGS).default([]),
    /**
     * People tagged in the body. Re-derived server-side from `body` against the
     * author's network — the client's list is a hint, never the authority, or a
     * crafted request could notify anyone.
     */
    mentions: z.array(MentionSchema).max(MAX_MENTIONS).default([]),
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

/**
 * A single post, as the share page and the permalink route see it.
 *
 * The viewer-relative bits come along so a permalink opened from a shared link
 * renders a working post card — likes, comments and reshare state included —
 * rather than a read-only stub that loses every action the feed has.
 */
/**
 * One person in a post's "liked by" line.
 *
 * Deliberately thinner than `PersonSummary`: a face and a name is all the line
 * renders, and resolving relationships for every reactor on every card in a
 * feed page would cost more than the whole rest of the request.
 */
export const PostReactorSchema = z.object({
  id: IdSchema,
  displayName: z.string().max(140),
  photoUrl: z.string().url().nullable(),
});
export type PostReactor = z.infer<typeof PostReactorSchema>;

/** How many reactor faces a card samples before falling back to the count. */
export const REACTOR_PREVIEW_SIZE = 3;

export const PostDetailSchema = z.object({
  post: PostSchema,
  hasReacted: z.boolean(),
  /** FR-1007 — whether this viewer has saved it. */
  isBookmarked: z.boolean().default(false),
  /** Whether the viewer follows the author, so the card can offer the button. */
  isFollowingAuthor: z.boolean().default(false),
  /** The first few people who reacted — "Liked by Ada and 24 others". */
  reactors: z.array(PostReactorSchema).default([]),
  /** Absolute URL, built server-side so the client never guesses its origin. */
  shareUrl: z.string().url(),
});
export type PostDetail = z.infer<typeof PostDetailSchema>;

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
  /** People tagged in the comment body — see `MentionSchema`. */
  mentions: z.array(MentionSchema).max(MAX_MENTIONS).default([]),
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
  /** A hint. Re-derived server-side against the author's network. */
  mentions: z.array(MentionSchema).max(MAX_MENTIONS).default([]),
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
  bannerUrl: z.string().url().nullable().default(null),
  headline: z.string().max(160).nullable(),
  activeRole: ActiveRoleSchema,
  isVerified: z.boolean(),
  companyName: z.string().max(160).nullable(),
  location: z.string().max(120).nullable(),
  relationship: RelationshipSchema,
  isFollowing: z.boolean(),
  /**
   * Whether they follow the viewer.
   *
   * Drives "Follow back" rather than "Follow" — a materially different ask,
   * and the distinction Instagram and LinkedIn both make because reciprocating
   * is a much easier decision than starting.
   */
  followsYou: z.boolean().default(false),
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

/* ======================================================= Company pages ==== */

/**
 * FR-1008 — a company's public page.
 *
 * `isFollowing` and `canEdit` are resolved server-side for the same reason the
 * person payload resolves relationship: the client should never have to make a
 * second request to know which button to draw.
 */
export const CompanyProfileSchema = z.object({
  company: CompanySchema,
  isFollowing: z.boolean(),
  /** True for the owner and hiring managers — drives the edit affordance. */
  canEdit: z.boolean(),
  followerCount: z.number().int().nonnegative(),
  openRoleCount: z.number().int().nonnegative(),
  /** The team, as far as it is safe to show — recruiters at this company. */
  people: z.array(PersonSummarySchema).max(12),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

export const CompanyQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  /** Verified employers first — FR-302 makes that the trust signal that counts. */
  verifiedOnly: z.coerce.boolean().default(false),
});
export type CompanyQuery = z.infer<typeof CompanyQuerySchema>;

/** A company as it appears in a browse list. */
export const CompanyCardSchema = z.object({
  id: IdSchema,
  name: z.string(),
  logoUrl: z.string().url().nullable(),
  industry: z.string().nullable(),
  headquarters: z.string().nullable(),
  isVerified: z.boolean(),
  isFollowing: z.boolean(),
  openRoleCount: z.number().int().nonnegative(),
});
export type CompanyCard = z.infer<typeof CompanyCardSchema>;

/** What a company owner may change about their own page. */
export const UpdateCompanySchema = z.object({
  description: z.string().trim().max(4000).nullable().optional(),
  industry: z.string().trim().max(80).nullable().optional(),
  website: z.string().trim().url('Enter a full URL, including https://').nullable().optional(),
  headquarters: z.string().trim().max(120).nullable().optional(),
  sizeBand: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
});
export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;

/* ======================================================== Moderation ====== */

export const ReportTargetSchema = z.enum([
  'listing',
  'message',
  'post',
  'comment',
  'profile',
  'company',
]);
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
  /**
   * The document the target lives under, when it is not top-level.
   *
   * Comments are a subcollection of their post and messages of their thread, so
   * an ID alone cannot be resolved back to the content. Without this a comment
   * report reaches the queue as "no longer available", which is unactionable —
   * a moderator cannot judge something they cannot read.
   */
  parentId: IdSchema.nullable().optional(),
  reason: ReportReasonSchema,
  detail: z.string().trim().max(1000).optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportSchema>;

export const ModerationFlagSchema = z.object({
  id: IdSchema,
  targetType: ReportTargetSchema,
  targetId: IdSchema,
  /** Parent document for subcollection targets — see `CreateReportSchema`. */
  parentId: IdSchema.nullable().default(null),
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

/* -------------------------------------------------------- admin console -- */

/**
 * A queue entry with enough of the reported thing attached to judge it.
 *
 * A flag on its own is a target type and an ID — unactionable. A moderator
 * needs to read what was actually said, and clicking through to find it is how
 * a queue stops being worked.
 */
export const ModerationFlagViewSchema = z.object({
  flag: ModerationFlagSchema,
  /** The reported content, redacted to what a moderator needs. Null if gone. */
  target: z
    .object({
      kind: ReportTargetSchema,
      title: z.string().max(200),
      body: z.string().max(2000),
      authorId: IdSchema.nullable(),
      authorName: z.string().max(160).nullable(),
      mediaUrl: z.string().url().nullable(),
    })
    .nullable(),
  reporterName: z.string().max(160).nullable(),
});
export type ModerationFlagView = z.infer<typeof ModerationFlagViewSchema>;

export const ModerationQuerySchema = z.object({
  status: z.enum(['open', 'reviewing', 'actioned', 'dismissed']).default('open'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ModerationQuery = z.infer<typeof ModerationQuerySchema>;

/**
 * FR-1107 — the escalation ladder.
 *
 * Ordered by severity, and deliberately explicit rather than inferred from the
 * report reason: the same reason can warrant a warning or a ban depending on
 * history, and that judgement is the moderator's to make and to be accountable
 * for. `dismiss` is first because most of a queue is noise.
 */
export const ModerationActionSchema = z.enum([
  'dismiss',
  'warn',
  'remove_content',
  'restrict_account',
  'suspend_account',
  'ban_account',
]);
export type ModerationAction = z.infer<typeof ModerationActionSchema>;

export const ResolveFlagSchema = z.object({
  action: ModerationActionSchema,
  /** Recorded on the flag. Required for anything above a dismissal (§9.3). */
  note: z.string().trim().max(1000).optional(),
});
export type ResolveFlagInput = z.infer<typeof ResolveFlagSchema>;

export const ModerationStatsSchema = z.object({
  open: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  actionedToday: z.number().int().nonnegative(),
  /** Age of the oldest unreviewed flag, in hours — the number that matters. */
  oldestOpenHours: z.number().nonnegative(),
});
export type ModerationStats = z.infer<typeof ModerationStatsSchema>;

/* ===================================================== Profile views ====== */

/**
 * FR-1001 — "who looked at your profile".
 *
 * Stored one row per (viewer, subject) pair rather than one per visit: the
 * question people actually ask is *who*, not *how many times*, and an
 * append-only log would grow without bound to answer a worse question. `count`
 * keeps the repeat-visit signal without keeping the rows.
 */
export const ProfileViewerSchema = z.object({
  person: PersonSummarySchema,
  viewedAt: IsoDateSchema,
  count: z.number().int().positive(),
});
export type ProfileViewer = z.infer<typeof ProfileViewerSchema>;

export const ProfileViewsSchema = z.object({
  /** Distinct viewers in the window below. */
  total: z.number().int().nonnegative(),
  windowDays: z.number().int().positive(),
  viewers: z.array(ProfileViewerSchema),
});
export type ProfileViews = z.infer<typeof ProfileViewsSchema>;

/** How far back the viewers list looks. Older than this is not news. */
export const PROFILE_VIEW_WINDOW_DAYS = 30;

/* ============================================================== Search ==== */

/**
 * FR-1006 — one search box across people, companies, posts and hashtags.
 *
 * Everything is matched in-process over bounded pools, the same trade the
 * people directory makes: Firestore has no substring index, so a server-side
 * filter would only ever be a prefix match on a single field. The ceiling is
 * the same too — when the pool stops containing what people search for, the
 * answer is a search index, not a bigger pool.
 */
export const SearchScopeSchema = z.enum(['all', 'people', 'companies', 'posts']);
export type SearchScope = z.infer<typeof SearchScopeSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for').max(80),
  scope: SearchScopeSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultsSchema = z.object({
  people: z.array(PersonSummarySchema),
  companies: z.array(CompanyCardSchema),
  posts: z.array(PostSchema),
  /** Hashtags matching the term, with how many posts carry each. */
  hashtags: z.array(z.object({ tag: z.string(), postCount: z.number().int().nonnegative() })),
});
export type SearchResults = z.infer<typeof SearchResultsSchema>;

/* ======================================================= Notifications ==== */

/**
 * Who did the thing.
 *
 * Resolved server-side and attached to the notification, because the alternative
 * is what shipped first: "Someone reacted to your post". A notification without
 * a name is not actionable, and every client would otherwise have to fan out a
 * profile fetch per row to fix it.
 */
export const NotificationActorSchema = z.object({
  id: IdSchema,
  displayName: z.string().max(140),
  photoUrl: z.string().url().nullable(),
  headline: z.string().max(160).nullable(),
});
export type NotificationActor = z.infer<typeof NotificationActorSchema>;

/**
 * What the thing was done to, with enough of it to recognise.
 *
 * `preview` is the post's opening words or the comment's text — the difference
 * between "someone commented on your post" and knowing which post, and whether
 * it needs an answer.
 */
export const NotificationTargetSchema = z.object({
  kind: z.enum(['post', 'comment', 'thread', 'listing', 'profile', 'company']),
  id: IdSchema,
  preview: z.string().max(240),
  mediaUrl: z.string().url().nullable(),
});
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;

export const NotificationTypeSchema = z.enum([
  'message_received',
  'message_request',
  'connection_request',
  'connection_accepted',
  'application_status_changed',
  'application_received',
  'interview_scheduled',
  'post_reaction',
  'post_comment',
  'post_reshare',
  'comment_reaction',
  'mention',
  'new_follower',
  'follow_back',
  'profile_view',
  'new_post_from_following',
  'following_activity',
  'reengagement',
  'company_verified',
  'listing_match',
]);
export type NotificationTypeName = z.infer<typeof NotificationTypeSchema>;

export const NotificationViewSchema = z.object({
  id: IdSchema,
  type: NotificationTypeSchema.or(z.string()),
  payload: z.record(z.string(), z.unknown()),
  urgent: z.boolean(),
  readAt: IsoDateSchema.nullable(),
  createdAt: IsoDateSchema,
  actor: NotificationActorSchema.nullable(),
  target: NotificationTargetSchema.nullable(),
});
export type NotificationView = z.infer<typeof NotificationViewSchema>;
