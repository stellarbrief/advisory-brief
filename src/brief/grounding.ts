import type { AudienceImpact, Claim, RawBrief, VerifiedBrief } from './schema';

/** Whitespace/case normalization for substring matching -- a real advisory pasted from
 * Discord/a webpage can have irregular whitespace (newlines, non-breaking spaces collapsed
 * by the browser) that would otherwise make an exact-match check reject a genuinely verbatim
 * quote. Case-insensitive for the same reason: a model restating "Mainnet" as "mainnet"
 * inside its own quote field shouldn't fail verification over capitalization alone. */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Digit sequences in a string, including dotted/comma-grouped ones such as versions
 * ("29.0.0") and numbers ("1,000"). Leading zeros are dropped per part, so "01" and "1" (the
 * same day written two ways) compare equal. */
function extractFigures(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((f) => f.replace(/\d+/g, (d) => String(Number(d))));
}

/** True when every figure in `text` (digit runs, versions, and the parts of a date) also
 * appears in the already-normalized source. A date the model reformatted ("Oct 1" for "October
 * 1st") still passes, because only its digits are compared. A figure only matches a whole figure
 * in the source, so "29" is not found inside "2900". Purely deterministic: it checks figures,
 * not meaning. */
function figuresAppearInSource(text: string, normalizedSource: string): boolean {
  const sourceFigures = new Set(extractFigures(normalizedSource));
  return extractFigures(text).every((f) => sourceFigures.has(f));
}

/** Month names (full and common short forms) mapped to their 1-based month number. `sept` is the
 * usual abbreviation for September alongside `sep`, so both map to 9. */
const MONTH_NUMBER: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Alternation of every month name/short form, longest first so "september" is not read as "sep"
 * (and "march" not as "mar"). Used with word boundaries so a month inside an unrelated word
 * (e.g. "mar" in "market") is never matched. */
const MONTH_PATTERN =
  'september|february|november|december|january|october|august|march|april|june|july|sept|feb|mar|apr|may|aug|oct|nov|dec|jan|jun|jul|sep';

/** `MONTH_PATTERN` with "may" removed, for the day-first form only. A day-first "28 may" is
 * ordinary wording ("protocol 28 may ..."), not a date, and "may" is the one month name that is
 * also a common English word, so it is never read as a month in day-first position. */
const MONTH_PATTERN_DAY_FIRST =
  'september|february|november|december|january|october|august|march|april|june|july|sept|feb|mar|apr|aug|oct|nov|dec|jan|jun|jul|sep';

/** The day part of a written date: one or two digits plus an optional ordinal suffix
 * ("1", "01", "1st", "21st"). Two digits are enough for any day; a four-digit year ("2026") is
 * never matched because the word-boundary check after the digits fails against the remaining
 * digits. */
const DAY_PATTERN = '\\d{1,2}(?:st|nd|rd|th)?';

/** Every month-day pair in `s`, canonicalized to `"<monthNumber>-<dayNumber>"` (for example
 * "November 1" -> "11-1"). Recognizes a month name next to a day in either order ("October 1",
 * "1 October"), full and short month names ("October", "Oct", "Sept"), and ordinal suffixes
 * ("1st"). ISO dates ("2026-10-01") are also read as a pair so a written "October 1 2026" can
 * ground against them.
 *
 * "may" is handled specially because it is also an ordinary word: a day-first "28 may" is
 * wording ("protocol 28 may ..."), not a date, so "may" is not read as a month in day-first
 * position (a month-first "May 28" still is).
 *
 * A month name that runs on into a longer or hyphenated word ("marching", "march-in") is not a
 * month: a plain `\b` after the name already stops a following letter, but also needs to reject
 * a trailing hyphen, which is a non-word character. A month name with no day next to it is
 * deliberately NOT a pair, so it is left to the digits-only figure check rather than rejected. */
function extractMonthDayPairs(s: string): Set<string> {
  const pairs = new Set<string>();
  const lower = s.toLowerCase();

  const addPair = (monthStr: string, dayStr: string) => {
    const monthNum = MONTH_NUMBER[monthStr];
    if (monthNum === undefined) return;
    const dayNum = Number(dayStr.replace(/st|nd|rd|th$/i, ''));
    pairs.add(`${monthNum}-${dayNum}`);
  };

  // Month-first ("October 1", "Oct 1", "May 28").
  const monthDayRe = new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(${DAY_PATTERN})\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = monthDayRe.exec(lower)) !== null) {
    addPair(m[1], m[2]);
  }

  // Day-first ("1 October", "1 Oct"), with "may" excluded so "28 may" is not read as a date.
  // `(?![\w-])` after the name rejects a hyphenated word ("march-in") that a plain word boundary
  // would accept.
  const dayMonthRe = new RegExp(`\\b(${DAY_PATTERN})\\s+(${MONTH_PATTERN_DAY_FIRST})(?![\\w-])`, 'g');
  while ((m = dayMonthRe.exec(lower)) !== null) {
    addPair(m[2], m[1]);
  }

  const isoRe = /(\d{4})-(\d{2})-(\d{2})/g;
  while ((m = isoRe.exec(lower)) !== null) {
    const monthNum = Number(m[2]);
    const dayNum = Number(m[3]);
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      pairs.add(`${monthNum}-${dayNum}`);
    }
  }

  return pairs;
}

/** True when every written month-day pair in `text` also appears in the source, so a claim that
 * states the right day but the wrong month ("November 1" for "October 1st") is rejected. Only
 * explicit pairs are checked: a day with no month name next to it forms no pair and stays a
 * digits-only comparison, so an unreadable date is never rejected here. */
function monthDayPairsAppearInSource(text: string, normalizedSource: string): boolean {
  const textPairs = extractMonthDayPairs(text);
  if (textPairs.size === 0) return true;
  const sourcePairs = extractMonthDayPairs(normalizedSource);
  for (const pair of textPairs) {
    if (!sourcePairs.has(pair)) return false;
  }
  return true;
}

/** The text of the placeholder that replaces a claim whose quote was not found in the source. */
export const REMOVED_CLAIM_TEXT = 'A claim here could not be verified against the source advisory and was removed.';

/** A claim that failed verification is never silently dropped from the record -- it's
 * replaced with an explicit, visible "this was removed" marker so `whatHappened.length`
 * etc. don't just quietly shrink with no explanation in the rendered brief. */
function rejectedClaimPlaceholder(): Claim {
  return {
    text: REMOVED_CLAIM_TEXT,
    quote: null,
    unknown: true,
  };
}

/** True for the placeholder that replaced a removed claim. A removed claim is also marked
 * `unknown` (it has no quote), but it is NOT the same as a claim the model itself marked unknown:
 * one was checked and failed, the other had nothing to check. Anything that shows claims to a
 * reader should tell them apart. */
export function isRemovedClaim(claim: Claim): boolean {
  return claim.unknown && claim.quote === null && claim.text === REMOVED_CLAIM_TEXT;
}

/** What happened to one claim:
 *  - `verified`: it cites a quote, and that quote was found in the source.
 *  - `unknown`: the model marked it unknown and cites no quote, so there is nothing to check.
 *  - `rejected`: its quote was NOT found in the source, or its text states a figure (number,
 *    version, date) that is not in the source, so it was removed.
 * `unknown` is counted separately and never as `verified`: a claim with no quote has not been
 * checked against anything. */
type ClaimStatus = 'verified' | 'unknown' | 'rejected';

interface CheckResult {
  claim: Claim;
  status: ClaimStatus;
}

interface Tally {
  total: number;
  verified: number;
  unknown: number;
  rejected: number;
}

function checkClaim(claim: Claim, normalizedSource: string): CheckResult {
  if (claim.unknown) {
    return { claim, status: 'unknown' };
  }
  const normalizedQuote = normalizeForMatch(claim.quote!);
  if (
    normalizedQuote.length > 0 &&
    normalizedSource.includes(normalizedQuote) &&
    figuresAppearInSource(claim.text, normalizedSource) &&
    monthDayPairsAppearInSource(claim.text, normalizedSource)
  ) {
    return { claim, status: 'verified' };
  }
  return { claim: rejectedClaimPlaceholder(), status: 'rejected' };
}

function checkAndCount(claim: Claim, normalizedSource: string, tally: Tally): Claim {
  const result = checkClaim(claim, normalizedSource);
  tally.total++;
  tally[result.status]++;
  return result.claim;
}

function checkClaims(claims: Claim[], normalizedSource: string, tally: Tally): Claim[] {
  return claims.map((c) => checkAndCount(c, normalizedSource, tally));
}

/**
 * The actual enforcement of Advisory Brief's core rule: this is CODE, not a model call,
 * deciding what survives into the brief a user sees. Every `Claim` with `unknown: false` must
 * carry a `quote` that is a real (normalized) substring of `sourceText`, or it's replaced with
 * a visible rejection placeholder. Every `urgency.deadlines` entry must likewise appear in the
 * source, or it's dropped from the list entirely (dates don't need a placeholder the way
 * claims do -- a missing date is just absent, not a broken sentence).
 *
 * A claim must also pass a figure check: every number, version and date part in its `text`
 * must appear in the source, so a real quote cannot carry a wrong "29.0.1". This checks that
 * quotes and figures exist in the source. It does not check that a claim's wording is
 * supported by its quote, and claims marked unknown are counted separately because they carry
 * nothing to check.
 */
export function verifyBrief(raw: RawBrief, sourceText: string, sourceUrl: string | null, sourceLabel: string): VerifiedBrief {
  const normalizedSource = normalizeForMatch(sourceText);
  const tally: Tally = { total: 0, verified: 0, unknown: 0, rejected: 0 };

  const whatHappened = checkClaims(raw.whatHappened, normalizedSource, tally);

  const urgencyReason = checkAndCount(raw.urgency.reason, normalizedSource, tally);

  const affected: AudienceImpact[] = raw.affected.map((a) => ({
    ...a,
    explanation: checkAndCount(a.explanation, normalizedSource, tally),
  }));

  const whatToTellYourTeam = checkClaims(raw.whatToTellYourTeam, normalizedSource, tally);

  const rejectedDates: string[] = [];
  const deadlines = raw.urgency.deadlines.filter((d) => {
    if (normalizeForMatch(d).length > 0 && normalizedSource.includes(normalizeForMatch(d))) {
      return true;
    }
    rejectedDates.push(d);
    return false;
  });

  return {
    whatHappened,
    urgency: {
      level: raw.urgency.level,
      reason: urgencyReason,
      deadlines,
    },
    affected,
    whatToTellYourTeam,
    whatWeDontKnow: raw.whatWeDontKnow,
    verification: {
      totalClaims: tally.total,
      verifiedClaims: tally.verified,
      unknownClaims: tally.unknown,
      rejectedClaims: tally.rejected,
      rejectedDates,
    },
    sourceUrl,
    sourceLabel,
  };
}
