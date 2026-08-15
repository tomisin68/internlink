/**
 * FR-1101 / §9.1 — scam and data-harvesting detection.
 *
 * Scope, stated plainly: this is a triage tool, not a filter. It never blocks a
 * message or a listing. It raises a moderation flag so a human looks sooner.
 * That is deliberate — a false positive that silently swallows a legitimate
 * recruiter's message is a worse failure than a false negative that a moderator
 * catches an hour later.
 *
 * The patterns target what the SRS names for this market: fees for interviews,
 * requests for BVN or bank details, and pushing people off-platform where there
 * is no audit trail.
 */

export type ScamSeverity = 'critical' | 'high' | 'normal';

export interface ScamRule {
  id: string;
  severity: ScamSeverity;
  /** What a moderator sees in the queue. */
  label: string;
  pattern: RegExp;
}

/**
 * Rules are written against normalised text (see `normalise`), so they can
 * assume lowercase, collapsed whitespace, and de-obfuscated digits.
 */
export const SCAM_RULES: ScamRule[] = [
  // --- Critical: money moving from candidate to "employer" -----------------
  {
    id: 'payment_for_role',
    severity: 'critical',
    label: 'Asks candidate to pay for a job, interview or processing',
    pattern:
      /\b(pay|payment|transfer|send|deposit|remit)\b[^.!?]{0,40}\b(fee|charge|money|cash|amount|naira|ngn|#\s?\d|\d{4,})/,
  },
  {
    id: 'training_or_kit_fee',
    severity: 'critical',
    label: 'Up-front training, kit or registration fee',
    pattern: /\b(training|registration|application|processing|form|kit|uniform|screening)\s*fee\b/,
  },
  {
    id: 'bank_details_request',
    severity: 'critical',
    label: 'Requests BVN, NIN or bank account details',
    pattern: /\b(bvn|nin|account\s*(number|details)|atm\s*(pin|card)|card\s*number|cvv|otp)\b/,
  },
  {
    id: 'crypto_or_giftcard',
    severity: 'critical',
    label: 'Asks for crypto or gift cards',
    pattern: /\b(bitcoin|btc|usdt|crypto|gift\s*card|steam\s*card|itunes\s*card)\b/,
  },

  // --- High: pressure, off-platform moves, unrealistic offers --------------
  {
    id: 'off_platform_push',
    severity: 'high',
    label: 'Pushes conversation off-platform immediately',
    pattern:
      /\b(whatsapp|telegram|signal)\b[^.!?]{0,30}\b(only|instead|directly|asap|now|immediately)\b/,
  },
  {
    id: 'contact_harvest',
    severity: 'high',
    label: 'Requests personal contact details up front',
    pattern:
      /\bsend\s+(me\s+)?(your\s+)?(phone|whatsapp|number|address|home\s*address)\b/,
  },
  {
    id: 'no_interview_hire',
    severity: 'high',
    label: 'Offers a role with no interview or screening',
    pattern: /\b(no|without)\s+(interview|experience|cv|resume|qualification)s?\s+(needed|required|necessary)\b/,
  },
  {
    id: 'unrealistic_pay',
    severity: 'high',
    label: 'Unrealistic earnings claim',
    pattern:
      /\b(earn|make|income of|salary of)\b[^.!?]{0,25}\b\d{3,}\s*(k|thousand|million|m)\b[^.!?]{0,20}\b(daily|per\s*day|weekly|per\s*week)\b/,
  },
  {
    id: 'urgency_pressure',
    severity: 'high',
    label: 'High-pressure urgency language',
    pattern: /\b(limited\s+slots?|act\s+now|urgent(ly)?\s+needed|only\s+\d+\s+slots?\s+left)\b/,
  },

  // --- Normal: conduct, worth a look but not an emergency ------------------
  {
    id: 'romantic_solicitation',
    severity: 'normal',
    label: 'Romantic or personal solicitation in a professional channel',
    pattern: /\b(are you single|your girlfriend|your boyfriend|date me|be my (girl|boy)friend|send.{0,12}(nudes|pics of yourself))\b/,
  },
  {
    id: 'discriminatory_requirement',
    severity: 'normal',
    label: 'Possible discriminatory requirement',
    pattern:
      /\b(males?|females?|men|women|christians?|muslims?)\s+(only|preferred|need\s+apply)\b|\bmust\s+be\s+(single|unmarried|male|female)\b/,
  },
];

const LEET_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  $: 's',
  '@': 'a',
};

/**
 * Amounts, which must survive normalisation untouched.
 *
 * Without this guard, de-leeting turns "150k" into "isok" and every rule that
 * looks for a figure stops firing — the exact rules that catch "earn 150k
 * daily". Quantities are skipped wholesale rather than handled character by
 * character.
 */
const QUANTITY_TOKEN = /^[₦#$]?\d[\d,.]*\s*(k|m|bn|thousand|million)?$/i;

function deLeetToken(token: string): string {
  if (QUANTITY_TOKEN.test(token)) return token;
  if (!/[a-z]/.test(token)) return token;

  // Applied repeatedly until stable: one pass converts only the characters
  // already touching a letter, so "f33" needs a second pass to reach "fee".
  let current = token;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/(?<=[a-z])[013457$@]|[013457$@](?=[a-z])/g, (c) => LEET_MAP[c] ?? c);
  } while (current !== previous);

  return current;
}

/**
 * Folds the obfuscations spammers actually use.
 *
 * Two rules here exist because tests caught them breaking real detection:
 * de-leeting is skipped for quantity tokens (see above), and the repeat
 * collapse is letter-only — `(.)\1{2,}` would rewrite "5000" to "500" and
 * quietly defeat every amount pattern in the ruleset.
 */
export function normalise(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize('NFKD')
    // Zero-width characters, used to break keywords apart mid-word.
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .split(' ')
    .map(deLeetToken)
    .join(' ')
    // Collapse padded repeats: "feeeee" → "fee". Letters only.
    .replace(/([a-z])\1{2,}/g, '$1$1');
}

export interface ScamScanResult {
  isFlagged: boolean;
  severity: ScamSeverity | null;
  matchedRuleIds: string[];
  labels: string[];
}

const SEVERITY_RANK: Record<ScamSeverity, number> = { critical: 3, high: 2, normal: 1 };

/**
 * Scans free text and returns every rule that fired.
 *
 * Returns all matches rather than stopping at the first: a message that trips
 * three rules is a stronger signal than one that trips one, and the moderator
 * queue sorts on it.
 */
export function scanForScamPatterns(text: string): ScamScanResult {
  if (!text || text.trim().length === 0) {
    return { isFlagged: false, severity: null, matchedRuleIds: [], labels: [] };
  }

  const haystack = normalise(text);
  const matched = SCAM_RULES.filter((rule) => rule.pattern.test(haystack));

  if (matched.length === 0) {
    return { isFlagged: false, severity: null, matchedRuleIds: [], labels: [] };
  }

  const severity = matched.reduce<ScamSeverity>(
    (worst, rule) => (SEVERITY_RANK[rule.severity] > SEVERITY_RANK[worst] ? rule.severity : worst),
    'normal',
  );

  return {
    isFlagged: true,
    severity,
    matchedRuleIds: matched.map((r) => r.id),
    labels: matched.map((r) => r.label),
  };
}

/**
 * Listings get the same rules plus a stricter reading of payment language.
 *
 * A listing is a public, permanent document, so the bar for flagging is lower
 * than in a private message where context might excuse a phrase.
 */
export function scanListing(title: string, description: string): ScamScanResult {
  return scanForScamPatterns(`${title}\n${description}`);
}
