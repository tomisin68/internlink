import { describe, expect, it } from 'vitest';
import { normalise, scanForScamPatterns, scanListing } from './scam-detection.js';

describe('normalise', () => {
  it('folds leetspeak inside words', () => {
    expect(normalise('f33')).toBe('fee');
    expect(normalise('acc0unt')).toBe('account');
  });

  it('leaves standalone digits alone so amount patterns still fire', () => {
    expect(normalise('pay 5000 naira')).toContain('5000');
  });

  it('collapses padded repeats used to dodge matching', () => {
    expect(normalise('feeeee')).toBe('fee');
  });

  it('strips zero-width characters', () => {
    expect(normalise('b​v​n')).toBe('bvn');
  });
});

describe('scanForScamPatterns — critical', () => {
  it('flags a request for payment for a role', () => {
    const result = scanForScamPatterns(
      'Congratulations! To secure this position please pay a fee of 5000 naira today.',
    );
    expect(result.isFlagged).toBe(true);
    expect(result.severity).toBe('critical');
  });

  it('flags an up-front training fee', () => {
    const result = scanForScamPatterns('There is a small training fee before you can resume.');
    expect(result.matchedRuleIds).toContain('training_or_kit_fee');
    expect(result.severity).toBe('critical');
  });

  it('flags a request for BVN', () => {
    const result = scanForScamPatterns('Kindly send your BVN and account number for payroll setup.');
    expect(result.matchedRuleIds).toContain('bank_details_request');
    expect(result.severity).toBe('critical');
  });

  it('flags obfuscated BVN requests', () => {
    expect(scanForScamPatterns('send your b​v​n now').isFlagged).toBe(true);
  });

  it('flags gift card and crypto requests', () => {
    expect(scanForScamPatterns('Payment is via iTunes card only').matchedRuleIds).toContain(
      'crypto_or_giftcard',
    );
  });
});

describe('scanForScamPatterns — high', () => {
  it('flags an immediate push to WhatsApp', () => {
    const result = scanForScamPatterns('Do not reply here, message me on WhatsApp directly.');
    expect(result.matchedRuleIds).toContain('off_platform_push');
    expect(result.severity).toBe('high');
  });

  it('flags no-interview-required offers', () => {
    expect(
      scanForScamPatterns('Immediate hire, no interview needed, no experience required.')
        .matchedRuleIds,
    ).toContain('no_interview_hire');
  });

  it('flags unrealistic daily earnings claims', () => {
    expect(
      scanForScamPatterns('Earn 150k daily working from home!').matchedRuleIds,
    ).toContain('unrealistic_pay');
  });
});

describe('scanForScamPatterns — conduct', () => {
  it('flags romantic solicitation in a professional channel', () => {
    const result = scanForScamPatterns('Before we proceed — are you single?');
    expect(result.matchedRuleIds).toContain('romantic_solicitation');
    expect(result.severity).toBe('normal');
  });

  it('flags a discriminatory requirement', () => {
    expect(scanForScamPatterns('Females only need apply.').matchedRuleIds).toContain(
      'discriminatory_requirement',
    );
  });
});

describe('scanForScamPatterns — false positives', () => {
  // These are the cases that decide whether moderators trust the queue. A
  // flagger that cries wolf on ordinary recruiter messages gets ignored.
  const legitimate = [
    'Hi Ada, thanks for applying. Are you free for a call on Tuesday at 2pm?',
    'We were impressed by your portfolio. The role pays 250,000 naira monthly.',
    'Your interview is confirmed for Thursday. No preparation is needed, just be yourself.',
    'Please send your CV and a short cover note through the platform.',
    'The team works hybrid — two days in the Lagos office, three remote.',
    'We will cover your transport costs for the on-site interview.',
    'Congratulations, we would like to offer you the internship. Salary details attached.',
  ];

  it.each(legitimate)('does not flag: %s', (text) => {
    expect(scanForScamPatterns(text).isFlagged).toBe(false);
  });

  it('does not flag empty or whitespace-only input', () => {
    expect(scanForScamPatterns('').isFlagged).toBe(false);
    expect(scanForScamPatterns('   ').isFlagged).toBe(false);
  });
});

describe('severity escalation', () => {
  it('reports the worst severity when several rules fire', () => {
    const result = scanForScamPatterns(
      'Are you single? Also send your BVN and message me on WhatsApp directly.',
    );
    expect(result.matchedRuleIds.length).toBeGreaterThan(1);
    expect(result.severity).toBe('critical');
  });
});

describe('scanListing', () => {
  it('scans the title and description together', () => {
    const result = scanListing('Urgent role', 'Applicants must pay a registration fee of 2000.');
    expect(result.isFlagged).toBe(true);
  });

  it('passes an ordinary listing', () => {
    const result = scanListing(
      'Frontend Intern',
      'You will work with our React team for six months. We offer a monthly stipend and mentorship.',
    );
    expect(result.isFlagged).toBe(false);
  });
});
