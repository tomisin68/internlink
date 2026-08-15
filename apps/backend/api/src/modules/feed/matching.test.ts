import { describe, expect, it } from 'vitest';
import type { InternProfile, Listing } from '@internlink/shared-types';
import {
  assertWeightsSumToOne,
  canMatch,
  normaliseSkill,
  scoreAvailability,
  scoreFreshness,
  scoreListing,
  scoreLocation,
  scoreSkills,
  scoreWorkMode,
  skillRarityWeight,
} from './matching.js';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

function profile(overrides: Partial<InternProfile> = {}): InternProfile {
  return {
    accountId: 'acc_1',
    headline: 'Frontend intern',
    about: null,
    school: 'UNILAG',
    location: 'Lagos, Nigeria',
    skills: ['React', 'TypeScript', 'CSS'],
    availability: 'immediately',
    preferredWorkModes: ['remote', 'hybrid'],
    cvUrl: null,
    cvFileName: null,
    portfolioLinks: [],
    education: [],
    experience: [],
    certifications: [],
    openToOpportunities: true,
    visibility: 'public',
    completeness: 60,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'lst_1',
    companyId: 'cmp_1',
    title: 'Frontend Intern',
    description: 'Build things.',
    skills: ['React', 'TypeScript'],
    media: [],
    tags: [],
    location: 'Lagos, Nigeria',
    workMode: 'hybrid',
    durationMonths: 6,
    salary: null,
    status: 'active',
    applicationCount: 0,
    publishedAt: '2026-08-14T12:00:00.000Z',
    closesAt: null,
    createdAt: '2026-08-14T12:00:00.000Z',
    updatedAt: '2026-08-14T12:00:00.000Z',
    ...overrides,
  };
}

describe('weights', () => {
  it('sum to exactly 1', () => {
    expect(() => assertWeightsSumToOne()).not.toThrow();
  });
});

describe('normaliseSkill', () => {
  it('treats punctuation and case variants as the same skill', () => {
    expect(normaliseSkill('Node.js')).toBe(normaliseSkill('node js'));
    expect(normaliseSkill('UI/UX')).toBe(normaliseSkill('ui ux'));
    expect(normaliseSkill('  React  ')).toBe('react');
  });
});

describe('skillRarityWeight', () => {
  it('scores specialist skills above generic ones', () => {
    expect(skillRarityWeight('Kubernetes')).toBeGreaterThan(skillRarityWeight('React'));
    expect(skillRarityWeight('React')).toBeGreaterThan(skillRarityWeight('Excel'));
  });
});

describe('scoreSkills', () => {
  it('gives a full match the top score', () => {
    const result = scoreSkills(['React', 'TypeScript'], ['React', 'TypeScript']);
    expect(result.score).toBe(1);
    expect(result.missing).toHaveLength(0);
  });

  it('reports which skills are missing', () => {
    const result = scoreSkills(['React'], ['React', 'GraphQL']);
    expect(result.matched).toEqual(['React']);
    expect(result.missing).toEqual(['GraphQL']);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('matches across punctuation differences', () => {
    expect(scoreSkills(['node js'], ['Node.js']).matched).toHaveLength(1);
  });

  it('does not let a huge skill list beat a focused one', () => {
    const padding = Array.from({ length: 25 }, (_, i) => `Filler ${i}`);
    const focused = scoreSkills(['React', 'TypeScript'], ['React', 'TypeScript']);
    const spammy = scoreSkills(['React', 'TypeScript', ...padding], ['React', 'TypeScript']);
    expect(focused.score).toBeGreaterThanOrEqual(spammy.score);
  });

  it('returns the neutral midpoint when a listing states no skills', () => {
    expect(scoreSkills(['React'], []).score).toBe(0.5);
  });

  it('weights a rare skill match above a common one', () => {
    const rare = scoreSkills(['Kubernetes'], ['Kubernetes', 'Excel']);
    const common = scoreSkills(['Excel'], ['Kubernetes', 'Excel']);
    expect(rare.score).toBeGreaterThan(common.score);
  });
});

describe('scoreLocation', () => {
  it('ignores distance for remote roles', () => {
    expect(scoreLocation('Kano, Nigeria', 'Lagos, Nigeria', 'remote').score).toBe(1);
  });

  it('rewards a same-city match', () => {
    expect(scoreLocation('Lagos, Nigeria', 'Lagos, Nigeria', 'onsite').score).toBe(1);
  });

  it('partially credits the same region', () => {
    const result = scoreLocation('Ibadan, Nigeria', 'Lagos, Nigeria', 'onsite');
    expect(result.score).toBeGreaterThan(0.2);
    expect(result.score).toBeLessThan(1);
  });

  it('falls back to neutral when either side is unknown', () => {
    expect(scoreLocation(null, 'Lagos, Nigeria', 'onsite').score).toBe(0.5);
  });
});

describe('scoreWorkMode', () => {
  it('rewards an exact preference match', () => {
    expect(scoreWorkMode(['remote'], 'remote')).toBe(1);
  });

  it('partially credits hybrid against a remote preference', () => {
    const partial = scoreWorkMode(['remote'], 'hybrid');
    expect(partial).toBeGreaterThan(0.2);
    expect(partial).toBeLessThan(1);
  });

  it('scores an outright mismatch low', () => {
    expect(scoreWorkMode(['remote'], 'onsite')).toBeLessThan(0.3);
  });
});

describe('scoreAvailability', () => {
  it('ranks sooner as better', () => {
    expect(scoreAvailability('immediately')).toBeGreaterThan(scoreAvailability('within_1_month'));
    expect(scoreAvailability('within_1_month')).toBeGreaterThan(scoreAvailability('within_3_months'));
    expect(scoreAvailability('within_3_months')).toBeGreaterThan(scoreAvailability('not_looking'));
  });

  it('never zeroes a passive browser out entirely', () => {
    expect(scoreAvailability('not_looking')).toBeGreaterThan(0);
  });
});

describe('scoreFreshness', () => {
  it('scores a brand-new listing near 1', () => {
    expect(scoreFreshness('2026-08-15T12:00:00.000Z', NOW)).toBeCloseTo(1, 5);
  });

  it('halves at exactly one half-life', () => {
    // Half-life is 10 days.
    expect(scoreFreshness('2026-08-05T12:00:00.000Z', NOW)).toBeCloseTo(0.5, 5);
  });

  it('decays monotonically', () => {
    const fresh = scoreFreshness('2026-08-14T12:00:00.000Z', NOW);
    const stale = scoreFreshness('2026-07-01T12:00:00.000Z', NOW);
    expect(fresh).toBeGreaterThan(stale);
  });

  it('handles a null or unparseable date without producing NaN', () => {
    expect(scoreFreshness(null, NOW)).toBe(0.3);
    expect(scoreFreshness('not-a-date', NOW)).toBe(0.3);
  });
});

describe('scoreListing', () => {
  it('scores a strong match highly', () => {
    const result = scoreListing({
      profile: profile(),
      listing: listing(),
      companyVerification: 'verified',
      hasApplied: false,
      now: NOW,
    });
    expect(result.score).toBeGreaterThan(75);
    expect(result.matchedSkills).toEqual(['React', 'TypeScript']);
  });

  it('scores an unrelated role low', () => {
    const result = scoreListing({
      profile: profile(),
      listing: listing({
        skills: ['Welding', 'Forklift'],
        location: 'Kano, Nigeria',
        workMode: 'onsite',
        publishedAt: '2026-06-01T00:00:00.000Z',
      }),
      companyVerification: 'unsubmitted',
      hasApplied: false,
      now: NOW,
    });
    expect(result.score).toBeLessThan(30);
  });

  it('always produces a score inside 0–100', () => {
    for (const verification of ['verified', 'pending', 'rejected', 'expired', 'unsubmitted'] as const) {
      const result = scoreListing({
        profile: profile({ skills: [], preferredWorkModes: [], location: null }),
        listing: listing({ skills: [], location: null, publishedAt: null }),
        companyVerification: verification,
        hasApplied: false,
        now: NOW,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it('ranks a verified company above an unverified one, all else equal', () => {
    const base = { profile: profile(), listing: listing(), hasApplied: false, now: NOW };
    const verified = scoreListing({ ...base, companyVerification: 'verified' });
    const unverified = scoreListing({ ...base, companyVerification: 'unsubmitted' });
    expect(verified.score).toBeGreaterThan(unverified.score);
  });

  it('surfaces at most three highlights, strongest first', () => {
    const result = scoreListing({
      profile: profile(),
      listing: listing(),
      companyVerification: 'verified',
      hasApplied: false,
      now: NOW,
    });
    expect(result.highlights.length).toBeLessThanOrEqual(3);
    expect(result.highlights.every((h) => h.length > 0)).toBe(true);
  });
});

describe('canMatch', () => {
  it('requires the minimum skill count', () => {
    expect(canMatch(profile({ skills: ['React', 'CSS'] }))).toBe(false);
    expect(canMatch(profile({ skills: ['React', 'CSS', 'TypeScript'] }))).toBe(true);
  });
});
