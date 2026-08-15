import type {
  Company,
  CreateRecruiterProfileInput,
  RecruiterProfile,
  SessionPayload,
} from '@internlink/shared-types';
import { Collections, db } from '../../config/firebase.js';
import { docToEntity, nowIso, serialise } from '../../lib/firestore.js';
import { notFound } from '../../lib/errors.js';
import { buildSession, getAccount } from '../auth/auth.service.js';

/** Empty strings arrive from optional form inputs; Firestore should hold null. */
const nullify = (v: string | null | undefined): string | null => {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
};

export async function getCompany(companyId: string): Promise<Company | null> {
  const snap = await db().collection(Collections.companies).doc(companyId).get();
  return docToEntity<Company>(snap);
}

export async function getRecruiterProfile(accountId: string): Promise<RecruiterProfile | null> {
  const snap = await db().collection(Collections.recruiterProfiles).doc(accountId).get();
  if (!snap.exists) return null;
  return serialise<RecruiterProfile>({ accountId, ...snap.data() });
}

/**
 * Creates the company and the recruiter profile that owns it, in one batch.
 *
 * Batched deliberately: a recruiter profile pointing at a company that failed
 * to write leaves an account that can neither post nor re-run the wizard,
 * because `computeNextStep` would see a recruiter profile and send them to the
 * dashboard.
 *
 * FR-302 is *not* enforced here — verification gates publishing a listing, not
 * creating the account. Blocking sign-up on a CAC number would strand every
 * recruiter whose registration is still with the lawyers.
 */
export async function createRecruiterProfile(
  accountId: string,
  input: CreateRecruiterProfileInput,
): Promise<SessionPayload> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('Your account');

  const existing = await getRecruiterProfile(accountId);
  const ts = nowIso();

  const companyRef = existing?.companyId
    ? db().collection(Collections.companies).doc(existing.companyId)
    : db().collection(Collections.companies).doc();

  const cacNumber = nullify(input.company.cacNumber);

  const companyDoc: Omit<Company, 'id'> = {
    name: input.company.name,
    cacNumber,
    // Submitting a CAC number moves straight into the moderation queue
    // (FR-902); leaving it blank keeps the company in `unsubmitted`.
    verificationStatus: cacNumber ? 'pending' : 'unsubmitted',
    verificationDocUrl: null,
    verifiedAt: null,
    logoUrl: nullify(input.company.logoUrl),
    website: nullify(input.company.website),
    industry: input.company.industry,
    sizeBand: input.company.sizeBand,
    headquarters: input.company.headquarters,
    description: input.company.description,
    ownerAccountId: accountId,
    createdAt: existing ? (await getCompany(companyRef.id))?.createdAt ?? ts : ts,
    updatedAt: ts,
  };

  const recruiterDoc: Omit<RecruiterProfile, 'accountId'> = {
    companyId: companyRef.id,
    title: input.title,
    // Whoever creates the company owns it — FR-306's other roles arrive by
    // invitation only.
    companyRole: 'owner',
    phone: nullify(input.phone),
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };

  const batch = db().batch();
  batch.set(companyRef, companyDoc, { merge: true });
  batch.set(db().collection(Collections.recruiterProfiles).doc(accountId), recruiterDoc, {
    merge: true,
  });
  await batch.commit();

  return buildSession(account);
}

export async function updateCompany(
  companyId: string,
  accountId: string,
  patch: Partial<Omit<Company, 'id' | 'ownerAccountId' | 'createdAt'>>,
): Promise<Company> {
  const company = await getCompany(companyId);
  if (!company) throw notFound('That company');

  // Verification state is decided by moderators (FR-902), never by the owner.
  const {
    verificationStatus: _s,
    verifiedAt: _v,
    ...safe
  } = patch as Record<string, unknown> & Partial<Company>;
  void _s;
  void _v;

  const updatedAt = nowIso();
  await db()
    .collection(Collections.companies)
    .doc(companyId)
    .update({ ...safe, updatedAt });

  void accountId;
  return { ...company, ...(safe as Partial<Company>), updatedAt };
}
