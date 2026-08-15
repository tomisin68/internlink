import { Router } from 'express';
import { z } from 'zod';
import {
  ApplicationStatusSchema,
  PageQuerySchema,
  type Application,
  type ApplicationPublic,
  type Listing,
  type PageQuery,
} from '@internlink/shared-types';
import { asyncHandler, param } from '../../lib/async-handler.js';
import { sendCreated, sendOk } from '../../lib/respond.js';
import { conflict, forbidden, notFound, unauthenticated } from '../../lib/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';
import { writeLimiter } from '../../middleware/rate-limit.js';
import { Collections, db } from '../../config/firebase.js';
import { docToEntity, nowIso, paginateQuery } from '../../lib/firestore.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getInternProfile } from '../profiles/profiles.service.js';
import { getRecruiterProfile } from '../companies/companies.service.js';
import { emit } from '../notifications/events.js';

export const applicationsRouter = Router();

applicationsRouter.use(requireAuth);

const ApplySchema = z.object({
  listingId: z.string().min(1),
  coverNote: z.string().trim().max(2000).nullable().optional(),
});

/** FR-404 — internal notes must never reach the candidate. */
function stripInternal(application: Application): ApplicationPublic {
  const { internalNotes: _hidden, ...rest } = application;
  void _hidden;
  return rest;
}

/**
 * POST /v1/applications — FR-401, one-tap apply using the stored profile/CV.
 *
 * Idempotent by construction: the document ID is derived from listing + intern,
 * so a double-tap on a flaky connection cannot produce two applications. This
 * is the "idempotent write endpoint" §3.5 asks for, without needing the client
 * to generate and remember a key.
 */
applicationsRouter.post(
  '/',
  requireRole('intern'),
  writeLimiter,
  validate(ApplySchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { listingId, coverNote } = req.body as z.infer<typeof ApplySchema>;
    const accountId = req.auth.accountId;

    const listingSnap = await db().collection(Collections.listings).doc(listingId).get();
    const listing = docToEntity<Listing>(listingSnap);
    if (!listing || listing.status !== 'active') throw notFound('That role');

    const profile = await getInternProfile(accountId);
    if (!profile) throw forbidden('Finish your profile before applying.');

    const applicationId = `${listingId}_${accountId}`;
    const ref = db().collection(Collections.applications).doc(applicationId);

    if ((await ref.get()).exists) {
      throw conflict('You have already applied to this role.');
    }

    const ts = nowIso();
    const doc: Omit<Application, 'id'> = {
      listingId,
      internAccountId: accountId,
      companyId: listing.companyId,
      status: 'applied',
      coverNote: coverNote ?? null,
      cvUrl: profile.cvUrl,
      internalNotes: [],
      statusHistory: [{ status: 'applied', changedBy: accountId, changedAt: ts }],
      createdAt: ts,
      updatedAt: ts,
    };

    const batch = db().batch();
    batch.set(ref, doc);
    batch.update(listingSnap.ref, { applicationCount: FieldValue.increment(1) });
    await batch.commit();

    sendCreated(res, stripInternal({ id: applicationId, ...doc }));
  }),
);

/** GET /v1/applications/mine — the intern's tracker (FR-402). */
applicationsRouter.get(
  '/mine',
  requireRole('intern'),
  validate(PageQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { limit, cursor } = validated<typeof PageQuerySchema>(req, 'query') as PageQuery;

    const page = await paginateQuery<Application>(
      db().collection(Collections.applications),
      (c) =>
        c.where('internAccountId', '==', req.auth!.accountId).orderBy('createdAt', 'desc'),
      { limit, cursor },
    );

    sendOk(res, { ...page, items: page.items.map(stripInternal) });
  }),
);

/** GET /v1/applications/listing/:listingId — the recruiter's pipeline. */
applicationsRouter.get(
  '/listing/:listingId',
  requireRole('recruiter'),
  validate(PageQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { limit, cursor } = validated<typeof PageQuerySchema>(req, 'query') as PageQuery;

    const recruiter = await getRecruiterProfile(req.auth.accountId);
    if (!recruiter?.companyId) throw forbidden('Set up your company profile first.');

    const listingId = param(req, 'listingId');
    const listing = docToEntity<Listing>(
      await db().collection(Collections.listings).doc(listingId).get(),
    );
    if (!listing || listing.companyId !== recruiter.companyId) throw notFound('That role');

    const page = await paginateQuery<Application>(
      db().collection(Collections.applications),
      (c) => c.where('listingId', '==', listingId).orderBy('createdAt', 'desc'),
      { limit, cursor },
    );

    // Recruiters DO see internal notes — this is the one view that keeps them.
    sendOk(res, page);
  }),
);

const UpdateStatusSchema = z.object({ status: ApplicationStatusSchema });

/** PATCH /v1/applications/:id/status — FR-403, with the FR-405 audit trail. */
applicationsRouter.patch(
  '/:id/status',
  requireRole('recruiter'),
  writeLimiter,
  validate(UpdateStatusSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthenticated();
    const { status } = req.body as z.infer<typeof UpdateStatusSchema>;

    const recruiter = await getRecruiterProfile(req.auth.accountId);
    if (!recruiter?.companyId) throw forbidden('Set up your company profile first.');
    if (recruiter.companyRole === 'viewer') throw forbidden('Viewers cannot move candidates.');

    const ref = db().collection(Collections.applications).doc(param(req, 'id'));
    const application = docToEntity<Application>(await ref.get());
    if (!application || application.companyId !== recruiter.companyId) {
      throw notFound('That application');
    }

    const ts = nowIso();
    await ref.update({
      status,
      updatedAt: ts,
      statusHistory: FieldValue.arrayUnion({
        status,
        changedBy: req.auth.accountId,
        changedAt: ts,
      }),
    });

    // FR-405 — every status change notifies the candidate. Marked urgent so it
    // bypasses digest batching: "you have an offer" cannot wait for tomorrow.
    void emit({
      accountId: application.internAccountId,
      type: 'application_status_changed',
      payload: {
        applicationId: application.id,
        listingId: application.listingId,
        from: application.status,
        to: status,
      },
      urgent: true,
    });

    sendOk(res, { ...application, status, updatedAt: ts });
  }),
);
