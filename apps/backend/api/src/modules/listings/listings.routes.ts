import { Router } from 'express';
import { z } from 'zod';
import {
  ListingStatusSchema,
  PageQuerySchema,
  WorkModeSchema,
  type Listing,
  type PageQuery,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendCreated, sendOk } from '../../lib/respond.js';
import { forbidden, notFound, unauthenticated, verificationRequired } from '../../lib/errors.js';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import { Collections, db } from '../../config/firebase.js';
import { docToEntity, nowIso, paginateQuery } from '../../lib/firestore.js';
import { getCompany, getRecruiterProfile } from '../companies/companies.service.js';
import { scanListing } from '../moderation/scam-detection.js';
import { autoFlag } from '../moderation/moderation.service.js';

export const listingsRouter = Router();

const CreateListingSchema = z.object({
  title: z.string().trim().min(4, 'Give the role a title').max(160),
  description: z.string().trim().min(80, 'Describe the role in a little more detail').max(12000),
  skills: z.array(z.string().trim().min(1).max(48)).min(1, 'Add at least one skill').max(20),
  location: z.string().trim().max(120).nullable().optional(),
  workMode: WorkModeSchema,
  durationMonths: z.number().int().min(1).max(36).nullable().optional(),
  salary: z
    .object({
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
      currency: z.string().length(3).default('NGN'),
      period: z.enum(['month', 'year', 'stipend']),
    })
    .nullable()
    .optional()
    .refine((s) => !s || s.max >= s.min, { message: 'Maximum must be at least the minimum' }),
  status: ListingStatusSchema.default('draft'),
});

const ListingFilterSchema = PageQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  skill: z.string().trim().max(48).optional(),
  workMode: WorkModeSchema.optional(),
  location: z.string().trim().max(120).optional(),
});

/**
 * GET /v1/listings — FR-203.
 *
 * Firestore cannot do full-text search, so `q` is applied in-process over the
 * fetched page. That is honest for launch volumes and wrong at scale: once the
 * catalogue passes a few thousand active listings this needs to move to a
 * search index (Algolia/Typesense) to keep the sub-1s target in §5.1.
 */
listingsRouter.get(
  '/',
  optionalAuth,
  validate(ListingFilterSchema, 'query'),
  asyncHandler(async (req, res) => {
    const filters = validated<typeof ListingFilterSchema>(req, 'query');
    const collection = db().collection(Collections.listings);

    const page = await paginateQuery<Listing>(
      collection,
      (c) => {
        let q = c.where('status', '==', 'active');
        if (filters.skill) q = q.where('skills', 'array-contains', filters.skill);
        if (filters.workMode) q = q.where('workMode', '==', filters.workMode);
        if (filters.location) q = q.where('location', '==', filters.location);
        return q.orderBy('publishedAt', 'desc');
      },
      { limit: filters.limit, cursor: filters.cursor },
    );

    if (filters.q) {
      const needle = filters.q.toLowerCase();
      page.items = page.items.filter(
        (l) =>
          l.title.toLowerCase().includes(needle) ||
          l.skills.some((s) => s.toLowerCase().includes(needle)),
      );
    }

    sendOk(res, page);
  }),
);

listingsRouter.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const snap = await db().collection(Collections.listings).doc(param(req, 'id')).get();
    const listing = docToEntity<Listing>(snap);
    if (!listing) throw notFound('That listing');

    // Drafts and closed roles are visible only to the company that owns them.
    if (listing.status !== 'active') {
      const recruiter = req.auth ? await getRecruiterProfile(req.auth.accountId) : null;
      if (!recruiter || recruiter.companyId !== listing.companyId) throw notFound('That listing');
    }

    const company = await getCompany(listing.companyId);
    sendOk(res, { listing, company });
  }),
);

/**
 * POST /v1/listings — FR-303.
 *
 * FR-302 is enforced right here: a listing may be *created* as a draft by any
 * recruiter, but it cannot go live until the company is verified. Splitting it
 * that way lets people write the role while their CAC check is pending instead
 * of being locked out of the product entirely.
 */
listingsRouter.post(
  '/',
  requireAuth,
  requireRole('recruiter'),
  writeLimiter,
  validate(CreateListingSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const input = req.body as z.infer<typeof CreateListingSchema>;

    const recruiter = await getRecruiterProfile(req.auth.accountId);
    if (!recruiter?.companyId) throw forbidden('Set up your company profile first.');
    if (recruiter.companyRole === 'viewer') throw forbidden('Viewers cannot post roles.');

    const company = await getCompany(recruiter.companyId);
    if (!company) throw notFound('Your company');

    if (input.status === 'active' && company.verificationStatus !== 'verified') {
      throw verificationRequired(
        'Your company needs to be verified before a role can go live. Save it as a draft and we will email you the moment verification clears.',
      );
    }

    const ts = nowIso();
    const doc: Omit<Listing, 'id'> = {
      companyId: recruiter.companyId,
      title: input.title,
      description: input.description,
      skills: input.skills,
      location: input.location ?? null,
      workMode: input.workMode,
      durationMonths: input.durationMonths ?? null,
      salary: input.salary ?? null,
      status: input.status,
      applicationCount: 0,
      publishedAt: input.status === 'active' ? ts : null,
      closesAt: null,
      createdAt: ts,
      updatedAt: ts,
    };

    const ref = await db().collection(Collections.listings).add(doc);

    // FR-1101 — listings are scanned on the same rules as messages. A public,
    // permanent document earns the check even when the poster is verified.
    const scan = scanListing(input.title, input.description);
    if (scan.isFlagged && scan.severity) {
      void autoFlag({
        targetType: 'listing',
        targetId: ref.id,
        severity: scan.severity,
        matchedRules: scan.matchedRuleIds,
        labels: scan.labels,
        authorId: req.auth.accountId,
      });
    }

    sendCreated(res, { id: ref.id, ...doc });
  }),
);

/** GET /v1/listings/mine — the recruiter's own board, drafts included. */
listingsRouter.get(
  '/mine/all',
  requireAuth,
  requireRole('recruiter'),
  validate(PageQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { limit, cursor } = validated<typeof PageQuerySchema>(req, 'query') as PageQuery;

    const recruiter = await getRecruiterProfile(req.auth.accountId);
    if (!recruiter?.companyId) throw forbidden('Set up your company profile first.');

    const page = await paginateQuery<Listing>(
      db().collection(Collections.listings),
      (c) => c.where('companyId', '==', recruiter.companyId).orderBy('createdAt', 'desc'),
      { limit, cursor },
    );
    sendOk(res, page);
  }),
);
