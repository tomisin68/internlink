import { describe, expect, it } from 'vitest';
import { extractHashtags, extractMentions } from '@internlink/shared-types';

/**
 * These two functions decide who gets notified and which topic page a post
 * lands on, and both run on the server against untrusted text — so the edge
 * cases here are the ones that matter, not the happy path.
 */

describe('extractHashtags', () => {
  it('pulls tags out of a body and drops the hash', () => {
    expect(extractHashtags('Shipped it with #react and #typescript')).toEqual([
      'react',
      'typescript',
    ]);
  });

  it('lower-cases so #React and #react are one topic', () => {
    expect(extractHashtags('#React #react #REACT')).toEqual(['react']);
  });

  it('stops at punctuation rather than swallowing it', () => {
    expect(extractHashtags('Using #react, #node; and #go.')).toEqual(['react', 'node', 'go']);
  });

  it('ignores a bare hash and one-character tags', () => {
    expect(extractHashtags('# and #a are not tags')).toEqual([]);
  });

  it('ignores all-digit tags — "#2024" is noise, not a topic', () => {
    expect(extractHashtags('#2024 #q1 goals')).toEqual(['q1']);
  });

  it('handles accented and non-Latin characters', () => {
    expect(extractHashtags('#Lagos #ọmọ #naïve')).toEqual(['lagos', 'ọmọ', 'naïve']);
  });

  it('caps the list so a stuffed post cannot flood the index', () => {
    const body = Array.from({ length: 40 }, (_, i) => `#tag${i}`).join(' ');
    expect(extractHashtags(body)).toHaveLength(12);
  });

  it('returns nothing for a body with no tags', () => {
    expect(extractHashtags('Just a normal sentence.')).toEqual([]);
  });
});

describe('extractMentions', () => {
  const candidates = [
    { accountId: 'a1', displayName: 'Ada' },
    { accountId: 'a2', displayName: 'Ada Lovelace' },
    { accountId: 'a3', displayName: 'Tunde Bakare' },
  ];

  it('matches a candidate named in the body', () => {
    expect(extractMentions('nice one @Tunde Bakare', candidates)).toEqual([
      { accountId: 'a3', displayName: 'Tunde Bakare' },
    ]);
  });

  it('prefers the longest name so a surname is not orphaned', () => {
    // "@Ada Lovelace" contains "@Ada", and matching the short one first would
    // leave " Lovelace" dangling outside the link.
    expect(extractMentions('hi @Ada Lovelace', candidates)[0]?.accountId).toBe('a2');
  });

  it('is case-insensitive', () => {
    expect(extractMentions('hi @ada', candidates)).toHaveLength(1);
  });

  it('never returns someone who is not a candidate', () => {
    // The whole point of resolving server-side: a crafted body cannot conjure
    // a mention of somebody outside the author's network.
    expect(extractMentions('@Nobody At All', candidates)).toEqual([]);
  });

  it('does not repeat a person tagged twice', () => {
    expect(extractMentions('@Ada and again @Ada', candidates)).toHaveLength(1);
  });

  it('returns nothing when the body has no at-sign', () => {
    expect(extractMentions('Ada is great', candidates)).toEqual([]);
  });

  it('caps the number of people one post can tag', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      accountId: `id${i}`,
      displayName: `Person${i}`,
    }));
    const body = many.map((p) => `@${p.displayName}`).join(' ');
    expect(extractMentions(body, many)).toHaveLength(10);
  });
});
