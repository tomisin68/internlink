import type {
  Account,
  ActiveRole,
  Company,
  InternProfile,
  RecruiterProfile,
  Role,
  SessionPayload,
} from '@internlink/shared-types';
import { Collections, db, firebaseAuth } from '../../config/firebase.js';
import { docToEntity, nowIso, serialise } from '../../lib/firestore.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { InternLinkClaims } from '../../middleware/auth.js';

/**
 * Splits a social-provider display name into first/last.
 *
 * Google gives `given_name`/`family_name` when it has them, but not always —
 * and never for some Workspace accounts. The fallback takes the first token as
 * the first name and the remainder as the last, which is wrong for a minority
 * of names. That is why the client shows the split back to the user on the
 * profile step, editable, rather than treating it as settled.
 */
export function splitDisplayName(displayName: string | undefined): {
  firstName: string;
  lastName: string;
} {
  const cleaned = (displayName ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { firstName: '', lastName: '' };
  const parts = cleaned.split(' ');
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

/**
 * Where should this user land right now?
 *
 * Computed on the server and shipped in the session payload so the client never
 * re-derives it. Two implementations of this rule drifting apart is precisely
 * how you get an onboarding loop that bounces a user between two screens.
 */
export function computeNextStep(args: {
  account: Account;
  internProfile: InternProfile | null;
  recruiterProfile: RecruiterProfile | null;
}): SessionPayload['nextStep'] {
  const { account, internProfile, recruiterProfile } = args;

  // No role picked yet — FR-104.
  const nonAdminRoles = account.roles.filter((r) => r !== 'admin');
  if (nonAdminRoles.length === 0) return 'select_role';

  if (account.activeRole === 'intern' && !internProfile) return 'create_intern_profile';
  if (account.activeRole === 'recruiter' && !recruiterProfile) return 'create_recruiter_profile';

  return 'ready';
}

/** Mirrors the account's roles/status onto the Firebase token claims (SRS §3.5). */
export async function syncClaims(account: Account): Promise<void> {
  const claims: InternLinkClaims = {
    active_role: account.activeRole,
    roles: account.roles,
    status: account.status,
  };
  await firebaseAuth().setCustomUserClaims(account.id, claims);
}

export async function getAccount(accountId: string): Promise<Account | null> {
  const snap = await db().collection(Collections.accounts).doc(accountId).get();
  return docToEntity<Account>(snap);
}

async function getInternProfile(accountId: string): Promise<InternProfile | null> {
  const snap = await db().collection(Collections.internProfiles).doc(accountId).get();
  if (!snap.exists) return null;
  return serialise<InternProfile>({ accountId, ...snap.data() });
}

async function getRecruiterProfile(accountId: string): Promise<RecruiterProfile | null> {
  const snap = await db().collection(Collections.recruiterProfiles).doc(accountId).get();
  if (!snap.exists) return null;
  return serialise<RecruiterProfile>({ accountId, ...snap.data() });
}

async function getCompany(companyId: string | null): Promise<Company | null> {
  if (!companyId) return null;
  const snap = await db().collection(Collections.companies).doc(companyId).get();
  return docToEntity<Company>(snap);
}

/**
 * Exchanges a verified Firebase identity for an InternLink session, creating
 * the account document on first sight.
 *
 * This is the *only* place an account document is created. Sign-up via
 * email/password and sign-in via Google both funnel through here, so there is
 * one code path that decides what a new account looks like.
 */
export async function exchangeSession(args: {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string | undefined;
  photoUrl?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
}): Promise<SessionPayload> {
  const accountRef = db().collection(Collections.accounts).doc(args.uid);
  const existing = await accountRef.get();

  if (!existing.exists) {
    const fromProvider = splitDisplayName(args.displayName);
    const firstName = (args.firstName ?? fromProvider.firstName).trim();
    const lastName = (args.lastName ?? fromProvider.lastName).trim();

    const account: Account = {
      id: args.uid,
      email: args.email.toLowerCase(),
      firstName,
      lastName,
      displayName: [firstName, lastName].filter(Boolean).join(' ') || args.email.split('@')[0]!,
      photoUrl: args.photoUrl ?? null,
      // Empty until the user picks on the role screen. `computeNextStep` reads
      // this emptiness as "send them to select_role".
      roles: [],
      activeRole: 'intern',
      status: 'active',
      emailVerified: args.emailVerified,
      twoFactorEnabled: false,
      verificationTiers: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastActiveAt: nowIso(),
      onboardingCompletedAt: null,
    };

    // `roles` is intentionally allowed to be empty here even though the schema
    // says min(1) — the schema describes a *settled* account. Strip it from the
    // write and let the role screen fill it in.
    const { id, ...doc } = account;
    void id;
    await accountRef.set(doc);
    await syncClaims(account);

    logger.info({ accountId: args.uid }, 'Account created');
    return {
      account,
      internProfile: null,
      recruiterProfile: null,
      company: null,
      nextStep: 'select_role',
    };
  }

  const account = serialise<Account>({ id: args.uid, ...existing.data() });

  if (account.status === 'banned' || account.status === 'suspended') {
    throw forbidden('This account has been suspended.');
  }

  // Keep the mirrored fields honest — a user who verifies their email or
  // changes their Google avatar should see it reflected without a re-signup.
  const patch: Record<string, unknown> = { lastActiveAt: nowIso() };
  if (account.emailVerified !== args.emailVerified) patch.emailVerified = args.emailVerified;
  if (args.photoUrl && account.photoUrl !== args.photoUrl) patch.photoUrl = args.photoUrl;

  if (args.firstName !== undefined || args.lastName !== undefined) {
    const firstName = (args.firstName ?? account.firstName).trim();
    const lastName = (args.lastName ?? account.lastName).trim();
    const displayName = [firstName, lastName].filter(Boolean).join(' ') || account.displayName;

    if (account.firstName !== firstName) patch.firstName = firstName;
    if (account.lastName !== lastName) patch.lastName = lastName;
    if (account.displayName !== displayName) patch.displayName = displayName;
  }

  await accountRef.update(patch);

  const merged: Account = { ...account, ...(patch as Partial<Account>) };
  return buildSession(merged);
}

/** Assembles the full session payload for an already-known account. */
export async function buildSession(account: Account): Promise<SessionPayload> {
  const [internProfile, recruiterProfile] = await Promise.all([
    getInternProfile(account.id),
    getRecruiterProfile(account.id),
  ]);
  const company = await getCompany(recruiterProfile?.companyId ?? null);

  return {
    account,
    internProfile,
    recruiterProfile,
    company,
    nextStep: computeNextStep({ account, internProfile, recruiterProfile }),
  };
}

export async function getSession(accountId: string): Promise<SessionPayload> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('Your account');
  return buildSession(account);
}

/**
 * FR-104 — grants a role the account does not yet hold and makes it active.
 * Idempotent: re-selecting a held role just switches to it.
 */
export async function selectRole(accountId: string, role: 'intern' | 'recruiter'): Promise<SessionPayload> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('Your account');

  const roles: Role[] = account.roles.includes(role) ? account.roles : [...account.roles, role];
  const updated: Account = { ...account, roles, activeRole: role, updatedAt: nowIso() };

  await db()
    .collection(Collections.accounts)
    .doc(accountId)
    .update({ roles, activeRole: role, updatedAt: updated.updatedAt });
  await syncClaims(updated);

  logger.info({ accountId, role }, 'Role selected');
  return buildSession(updated);
}

/**
 * FR-103 / FR-105 — switch active role with no re-authentication.
 *
 * The account must already hold the role; granting happens through
 * `selectRole`. Keeping those separate means an accidental switch can never
 * silently create a half-built recruiter profile.
 */
export async function switchRole(accountId: string, role: ActiveRole): Promise<SessionPayload> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('Your account');

  if (!account.roles.includes(role)) {
    throw conflict(
      role === 'recruiter'
        ? 'Set up your recruiter profile first.'
        : `You do not have a ${role} profile yet.`,
    );
  }
  if (account.activeRole === role) return buildSession(account);

  const updated: Account = { ...account, activeRole: role, updatedAt: nowIso() };
  await db()
    .collection(Collections.accounts)
    .doc(accountId)
    .update({ activeRole: role, updatedAt: updated.updatedAt });
  await syncClaims(updated);

  logger.info({ accountId, role }, 'Active role switched');
  return buildSession(updated);
}

/** Marks the guided onboarding as done so the wizard stops intercepting. */
export async function completeOnboarding(accountId: string): Promise<SessionPayload> {
  const account = await getAccount(accountId);
  if (!account) throw notFound('Your account');

  const completedAt = nowIso();
  await db()
    .collection(Collections.accounts)
    .doc(accountId)
    .update({ onboardingCompletedAt: completedAt, updatedAt: completedAt });

  return buildSession({ ...account, onboardingCompletedAt: completedAt, updatedAt: completedAt });
}
