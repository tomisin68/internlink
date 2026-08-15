import { z } from 'zod';
import { IdSchema } from './entities.js';
import { ListingSchema } from './entities.js';
import { PostSchema, RelationshipSchema } from './social.js';

/* ======================================================= Match scoring ==== */

/**
 * FR-204 — the ranked "Matches for you" feed.
 *
 * Every score ships with its breakdown. That is a product decision as much as a
 * debugging one: a ranked feed that cannot say *why* it ranked something reads
 * as arbitrary, and "you match 6 of the 8 skills they asked for" is far more
 * useful to a candidate than "92%".
 */
export const MatchSignalSchema = z.enum([
  'skills',
  'location',
  'workMode',
  'availability',
  'freshness',
  'trust',
]);
export type MatchSignal = z.infer<typeof MatchSignalSchema>;

export const MatchBreakdownSchema = z.object({
  signal: MatchSignalSchema,
  /** 0–1, before weighting. */
  score: z.number().min(0).max(1),
  /** The signal's share of the total. Weights sum to 1 across all signals. */
  weight: z.number().min(0).max(1),
  /** Human-readable, shown in the UI. Empty when the signal is neutral. */
  reason: z.string(),
});
export type MatchBreakdown = z.infer<typeof MatchBreakdownSchema>;

export const MatchResultSchema = z.object({
  listing: ListingSchema,
  company: z
    .object({
      id: IdSchema,
      name: z.string(),
      logoUrl: z.string().url().nullable(),
      isVerified: z.boolean(),
    })
    .nullable(),
  /** 0–100, rounded. */
  score: z.number().int().min(0).max(100),
  breakdown: z.array(MatchBreakdownSchema),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  /** The two or three lines the card actually shows. */
  highlights: z.array(z.string()),
  hasApplied: z.boolean(),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;

export const MatchQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Hide anything scoring below this. Default keeps out the near-irrelevant. */
  minScore: z.coerce.number().int().min(0).max(100).default(25),
  includeApplied: z.coerce.boolean().default(false),
});
export type MatchQuery = z.infer<typeof MatchQuerySchema>;

/* ======================================================== Feed ranking ==== */

export const FeedReasonSchema = z.enum([
  'connection',
  'following_account',
  'following_company',
  'second_degree',
  'same_school',
  'popular',
  'your_post',
]);
export type FeedReason = z.infer<typeof FeedReasonSchema>;

export const FeedItemSchema = z.object({
  post: PostSchema,
  /** Why this is in your feed — rendered as the "Because you…" label. */
  reason: FeedReasonSchema,
  relationship: RelationshipSchema,
  score: z.number(),
  hasReacted: z.boolean(),
});
export type FeedItem = z.infer<typeof FeedItemSchema>;

export const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  /** `following` drops the global-popular backfill. */
  scope: z.enum(['for_you', 'following']).default('for_you'),
});
export type FeedQuery = z.infer<typeof FeedQuerySchema>;

/**
 * Tunables for both rankers, in one place.
 *
 * Exported rather than buried in the service so they can be adjusted, tested
 * against, and eventually driven by a remote config without touching logic.
 * The match weights must sum to 1 — `assertWeightsSumToOne` enforces it.
 */
export const RANKING_CONFIG = {
  match: {
    weights: {
      skills: 0.46,
      location: 0.13,
      workMode: 0.12,
      availability: 0.09,
      freshness: 0.12,
      trust: 0.08,
    },
    /** Listings older than this score 0 on freshness. */
    freshnessHalfLifeDays: 10,
    /** Below this many skills, matching is too noisy to be worth showing. */
    minSkillsToMatch: 3,
  },
  feed: {
    /** Higher = recency dominates harder. 1.5 is close to Hacker News. */
    gravity: 1.5,
    affinity: {
      your_post: 0.7,
      connection: 1,
      // Following is a deliberate choice, like connecting, but one-sided — it
      // sits just under a mutual connection and just above a company follow.
      following_account: 0.95,
      following_company: 0.92,
      second_degree: 0.55,
      same_school: 0.5,
      popular: 0.28,
    },
    /** Each additional post by the same author is multiplied by this again. */
    authorDiversityDecay: 0.55,
    /** Comments are worth more than reactions — they cost more to leave. */
    commentWeight: 2.5,
  },
} as const;
