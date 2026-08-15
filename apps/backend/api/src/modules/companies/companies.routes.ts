import { Router } from 'express';
import {
  CompanyQuerySchema,
  UpdateCompanySchema,
  type Company,
  type CompanyCard,
  type CompanyProfile,
  type Post,
  type UpdateCompanyInput,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendOk } from '../../lib/respond.js';
import { forbidden, notFound, unauthenticated } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import { Collections, db } from '../../config/firebase.js';
import { serialise } from '../../lib/firestore.js';
import * as companies from './companies.service.js';
import * as connections from '../connections/connections.service.js';
import * as people from '../connections/people.service.js';
import { hydratePostAuthors } from '../posts/author-hydration.js';

export const companiesRouter = Router();

companiesRouter.use(requireAuth);

/**
 * FR-1008 — company pages.
 *
 * Browse reads a bounded pool and filters in memory, the same trade the people
 * directory makes: Firestore has no substring search, so a server-side `q`
 * could only ever be a prefix match on one field. The ceiling is visible — once
 * the pool stops containing the company someone is looking for, the answer is a
 * search index, not a bigger pool.
 */
const BROWSE_POOL = 200;

/** Open roles per company, counted in one grouped read rather than N. */
async function openRoleCounts(companyIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (companyIds.length === 0) return counts;

  const chunks: string[][] = [];
  for (let i = 0; i < companyIds.length; i += 30) chunks.push(companyIds.slice(i, i + 30));

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      db()
        .collection(Collections.listings)
        .where('companyId', 'in', chunk)
        .where('status', '==', 'active')
        .get(),
    ),
  );

  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const id = doc.data().companyId as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return counts;
}

companiesRouter.get(
  '/',
  validate(CompanyQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const query = validated<typeof CompanyQuerySchema>(req, 'query');

    const [snap, follows] = await Promise.all([
      db()
        .collection(Collections.companies)
        .orderBy('createdAt', 'desc')
        .limit(BROWSE_POOL)
        .get(),
      connections.followedIds(req.auth.accountId),
    ]);

    let pool = snap.docs.map((doc) => serialise<Company>({ id: doc.id, ...doc.data() }));

    if (query.verifiedOnly) {
      pool = pool.filter((company) => company.verificationStatus === 'verified');
    }

    const term = query.q?.toLowerCase();
    if (term) {
      pool = pool.filter((company) =>
        [company.name, company.industry, company.headquarters]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(term)),
      );
    }

    const counts = await openRoleCounts(pool.map((c) => c.id));

    const items: CompanyCard[] = pool.map((company) => ({
      id: company.id,
      name: company.name,
      logoUrl: company.logoUrl,
      industry: company.industry,
      headquarters: company.headquarters,
      isVerified: company.verificationStatus === 'verified',
      isFollowing: follows.companies.has(company.id),
      openRoleCount: counts.get(company.id) ?? 0,
    }));

    // Verified employers with open roles first — that is the ordering a
    // candidate browsing companies is actually looking for.
    items.sort((a, b) => {
      if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
      return b.openRoleCount - a.openRoleCount;
    });

    sendOk(res, { items: items.slice(0, query.limit) });
  }),
);

companiesRouter.get(
  '/:companyId',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const companyId = param(req, 'companyId');

    const company = await companies.getCompany(companyId);
    if (!company) throw notFound('That company');

    const [follows, followerCount, roleCounts, teamSnap, viewerProfile] = await Promise.all([
      connections.followedIds(req.auth.accountId),
      connections.followerCount(companyId),
      openRoleCounts([companyId]),
      db()
        .collection(Collections.recruiterProfiles)
        .where('companyId', '==', companyId)
        .limit(12)
        .get(),
      companies.getRecruiterProfile(req.auth.accountId),
    ]);

    // Viewers cannot edit (FR-306); owners and hiring managers can.
    const canEdit =
      viewerProfile?.companyId === companyId && viewerProfile.companyRole !== 'viewer';

    const payload: CompanyProfile = {
      company,
      isFollowing: follows.companies.has(companyId),
      canEdit,
      followerCount,
      openRoleCount: roleCounts.get(companyId) ?? 0,
      people: await people.summariseAccounts(
        req.auth.accountId,
        teamSnap.docs.map((doc) => doc.id),
      ),
    };

    sendOk(res, payload);
  }),
);

/** The roles this company is hiring for — the reason most visitors are here. */
companiesRouter.get(
  '/:companyId/listings',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();

    const snap = await db()
      .collection(Collections.listings)
      .where('companyId', '==', param(req, 'companyId'))
      .where('status', '==', 'active')
      .orderBy('publishedAt', 'desc')
      .limit(20)
      .get();

    sendOk(res, { items: snap.docs.map((d) => serialise({ id: d.id, ...d.data() })) });
  }),
);

/** Posts published as this company. */
companiesRouter.get(
  '/:companyId/posts',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();

    const snap = await db()
      .collection(Collections.posts)
      .where('companyId', '==', param(req, 'companyId'))
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    // Flagged posts are hidden here as everywhere else — this route bypasses
    // the feed ranker, so the rule is restated rather than inherited.
    const items = snap.docs
      .map((d) => serialise<Post>({ id: d.id, ...d.data() }))
      .filter((post) => !post.isFlagged);

    // A logo changed after posting should not leave old posts showing the old
    // one — see `author-hydration`.
    sendOk(res, { items: await hydratePostAuthors(items) });
  }),
);

companiesRouter.patch(
  '/:companyId',
  writeLimiter,
  validate(UpdateCompanySchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const companyId = param(req, 'companyId');

    const profile = await companies.getRecruiterProfile(req.auth.accountId);
    if (profile?.companyId !== companyId || profile.companyRole === 'viewer') {
      throw forbidden('You cannot edit this company.');
    }

    const input = req.body as UpdateCompanyInput;
    // Empty strings arrive from cleared optional inputs; Firestore holds null.
    const patch = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value === '' ? null : value]),
    );

    sendOk(res, await companies.updateCompany(companyId, req.auth.accountId, patch));
  }),
);
