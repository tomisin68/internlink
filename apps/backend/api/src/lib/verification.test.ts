import { describe, expect, it } from 'vitest';
import { normaliseVerification, resolveAccountTiers, resolveCompanyStatus } from './verification.js';

describe('resolveCompanyStatus', () => {
  it('leaves a canonical status alone', () => {
    expect(resolveCompanyStatus({ verificationStatus: 'verified' })).toBe('verified');
    expect(resolveCompanyStatus({ verificationStatus: 'pending' })).toBe('pending');
    expect(resolveCompanyStatus({ verificationStatus: 'rejected' })).toBe('rejected');
  });

  it('accepts the spellings a console edit actually produces', () => {
    for (const raw of ['Verified', ' verified ', 'VERIFIED', 'approved', 'Approved', 'active']) {
      expect(resolveCompanyStatus({ verificationStatus: raw })).toBe('verified');
    }
  });

  it('reads a hand-added boolean flag, typed or stringly', () => {
    expect(resolveCompanyStatus({ verificationStatus: 'pending', isVerified: true })).toBe('verified');
    expect(resolveCompanyStatus({ verificationStatus: 'pending', isVerified: 'true' })).toBe('verified');
    expect(resolveCompanyStatus({ verificationStatus: 'unsubmitted', verified: true })).toBe('verified');
    expect(resolveCompanyStatus({ verificationStatus: 'pending', is_verified: 'yes' })).toBe('verified');
  });

  it('treats an explicit false flag as a revocation', () => {
    expect(resolveCompanyStatus({ verificationStatus: 'verified', isVerified: false })).toBe('unsubmitted');
    // …but does not disturb a status that was never an approval.
    expect(resolveCompanyStatus({ verificationStatus: 'pending', isVerified: false })).toBe('pending');
  });

  it('infers verification from a filled-in verifiedAt', () => {
    expect(
      resolveCompanyStatus({ verificationStatus: 'pending', verifiedAt: '2026-08-17T00:00:00.000Z' }),
    ).toBe('verified');
  });

  it('never infers past a moderator saying no', () => {
    expect(
      resolveCompanyStatus({ verificationStatus: 'rejected', verifiedAt: '2026-08-17T00:00:00.000Z' }),
    ).toBe('rejected');
    expect(
      resolveCompanyStatus({ verificationStatus: 'expired', verifiedAt: '2026-08-17T00:00:00.000Z' }),
    ).toBe('expired');
  });

  it('holds an unknown string at pending rather than pretending nothing was submitted', () => {
    expect(resolveCompanyStatus({ verificationStatus: 'waiting on CAC' })).toBe('pending');
  });

  it('defaults a missing field to unsubmitted', () => {
    expect(resolveCompanyStatus({})).toBe('unsubmitted');
    expect(resolveCompanyStatus({ verificationStatus: '' })).toBe('unsubmitted');
    expect(resolveCompanyStatus({ verificationStatus: null })).toBe('unsubmitted');
  });
});

describe('resolveAccountTiers', () => {
  it('keeps valid tiers and drops junk', () => {
    expect(resolveAccountTiers({ verificationTiers: ['verified_identity', 'nonsense'] })).toEqual([
      'verified_identity',
    ]);
  });

  it('accepts a comma-separated string, because arrays are painful in the console', () => {
    expect(resolveAccountTiers({ verificationTiers: 'verified_identity, company' })).toEqual([
      'verified_identity',
      'verified_company',
    ]);
  });

  it('grants the default tier from a boolean flag', () => {
    expect(resolveAccountTiers({ verificationTiers: [], isVerified: true })).toEqual([
      'verified_identity',
    ]);
    expect(resolveAccountTiers({ verified: 'true' })).toEqual(['verified_identity']);
  });

  it('does not overwrite a named tier with the default', () => {
    expect(resolveAccountTiers({ verificationTiers: ['verified_school_email'], isVerified: true })).toEqual([
      'verified_school_email',
    ]);
  });

  it('revokes on an explicit false', () => {
    expect(resolveAccountTiers({ verificationTiers: ['verified_identity'], isVerified: false })).toEqual([]);
  });

  it('de-duplicates aliases of the same tier', () => {
    expect(resolveAccountTiers({ verificationTiers: ['identity', 'verified_identity', 'kyc'] })).toEqual([
      'verified_identity',
    ]);
  });
});

describe('normaliseVerification', () => {
  it('canonicalises a company document in place', () => {
    const doc: Record<string, unknown> = {
      name: 'Paystack',
      ownerAccountId: 'acc_1',
      verificationStatus: 'Approved',
    };
    normaliseVerification(doc);
    expect(doc.verificationStatus).toBe('verified');
  });

  it('canonicalises an account document in place', () => {
    const doc: Record<string, unknown> = {
      roles: ['intern'],
      activeRole: 'intern',
      isVerified: true,
    };
    normaliseVerification(doc);
    expect(doc.verificationTiers).toEqual(['verified_identity']);
  });

  it('leaves a post author block alone', () => {
    const doc: Record<string, unknown> = {
      kind: 'account',
      id: 'acc_1',
      name: 'Ada Okonkwo',
      isVerified: false,
    };
    normaliseVerification(doc);
    expect(doc).not.toHaveProperty('verificationTiers');
    expect(doc).not.toHaveProperty('verificationStatus');
  });

  it('is idempotent', () => {
    const doc: Record<string, unknown> = {
      ownerAccountId: 'acc_1',
      name: 'Paystack',
      verificationStatus: 'verified',
    };
    normaliseVerification(doc);
    normaliseVerification(doc);
    expect(doc.verificationStatus).toBe('verified');
  });
});
