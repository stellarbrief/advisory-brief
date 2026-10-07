import type { AudienceImpact, Claim, RawBrief, VerifiedBrief } from './schema';

/** Whitespace/case normalization for substring matching -- a real advisory pasted from
 * Discord/a webpage can have irregular whitespace (newlines, non-breaking spaces collapsed
 * by the browser) that would otherwise make an exact-match check reject a genuinely verbatim
 * quote. Case-insensitive for the same reason: a model restating "Mainnet" as "mainnet"
 * inside its own quote field shouldn't fail verification over capitalization alone. */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The text of the placeholder that replaces a claim whose quote was not found in the source. */
export const REMOVED_CLAIM_TEXT = 'A claim here could not be verified against the source advisory and was removed.';

/** The text of the placeholder that replaces a claim whose quote was found, but whose own
 * wording states a number, version or date that does not appear anywhere in the source. */
export const REMOVED_FIGURE_TEXT = 'A claim here stated a figure that was not in the source advisory and was removed.';

const REMOVAL_TEXTS: ReadonlySet<string> = new Set([REMOVED_CLAIM_TEXT, REMOVED_FIGURE_TEXT]);

/** A claim that failed verification is never silently dropped from the record -- it's replaced
 * with an explicit, visible "this was removed" marker so `whatHappened.length` etc. don't just
 * quietly shrink with no explanation in the rendered brief. `reason` says which check failed:
 * the missing quote, or a figure in the claim's own wording. */
function rejectedClaimPlaceholder(reason: 'quote' | 'figures'): Claim {
  return {
    text: reason === 'quote' ? REMOVED_CLAIM_TEXT : REMOVED_FIGURE_TEXT,
    quote: null,
    unknown: true,
  };
}

/** True for the placeholder that replaced a removed claim. A removed claim is also marked
 * `unknown` (it has no quote), but it is NOT the same as a claim the model itself marked unknown:
 * one was checked and failed, the other had nothing to check. Anything that shows claims to a
 * reader should tell them apart. */
export function isRemovedClaim(claim: Claim): boolean {
  return claim.unknown && claim.quote === null && REMOVAL_TEXTS.has(claim.text);
}

/** True for the placeholder left by the figure check specifically, so a reader can be told the
 * claim was removed for a number/date in its wording rather than for an unfindable quote. */
export function isRemovedFigureClaim(claim: Claim): boolean {
  return isRemovedClaim(claim) && claim.text === REMOVED_FIGURE_TEXT;
}

/** A figure is a digit-bearing fact in a claim's wording: a date, a version, or a bare number. */
export type FigureKind = 'date' | 'version' | 'number';

export interface Figure {
  /** The literal text the figure was found in, kept for error messages and debugging. */
  raw: string;
  kind: FigureKind;
  /** The form compared against the source: `month/day` for dates, digits for versions/numbers. */
  canonical: string;
}

const MONTH_PATTERN =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const MONTH_NUMBER: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthNumber(name: string): number | undefined {
  return MONTH_NUMBER[name.slice(0, 3)];
}

/** Run `handle` over every match, then blank each matched span so a later pass cannot see the
 * same digits again. This is what keeps `29.0.0` from also being reported as 29, 0 and 0. */
function consume(text: string, regex: RegExp, handle: (match: RegExpExecArray) => void): string {
  let out = text;
  for (const match of text.matchAll(regex)) {
    handle(match);
    const start = match.index;
    out = out.slice(0, start) + ' '.repeat(match[0].length) + out.slice(start + match[0].length);
  }
  return out;
}

/** `1,024` and `0029` are the same figure as `1024` and `29`. */
function canonicalNumber(raw: string): string {
  return raw.replace(/,/g, '').replace(/^0+(?=\d)/, '');
}

/** Pull the digit-bearing facts out of a piece of text: dates written with a month name or in
 * ISO form, dotted versions, then whatever plain numbers remain. Dates and versions are consumed
 * first so their digits are not also reported as standalone numbers.
 *
 * The canonical form is deliberately lossy about *format* (`"Oct 1"` and `"October 1st"` both
 * become `10/1`) because a real run produced a correctly-summarised date the model had
 * reformatted. A wrong day or month still has a different canonical form, so it is still caught. */
export function extractFigures(text: string): Figure[] {
  const figures: Figure[] = [];
  let rest = consume(text.toLowerCase(), new RegExp(`\\b(${MONTH_PATTERN})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'), (m) => {
    const month = monthNumber(m[1]);
    if (month !== undefined) figures.push({ raw: m[0], kind: 'date', canonical: `${month}/${Number(m[2])}` });
  });
  rest = consume(rest, new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\b`, 'g'), (m) => {
    const month = monthNumber(m[2]);
    if (month !== undefined) figures.push({ raw: m[0], kind: 'date', canonical: `${month}/${Number(m[1])}` });
  });
  rest = consume(rest, /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) => {
    figures.push({ raw: m[0], kind: 'date', canonical: `${Number(m[2])}/${Number(m[3])}` });
    figures.push({ raw: m[1], kind: 'number', canonical: canonicalNumber(m[1]) });
  });
  rest = consume(rest, /\b\d+\.\d+(?:\.\d+)*\b/g, (m) => {
    figures.push({ raw: m[0], kind: 'version', canonical: m[0] });
  });
  consume(rest, /\d[\d,]*/g, (m) => {
    figures.push({ raw: m[0], kind: 'number', canonical: canonicalNumber(m[0]) });
  });
  return figures;
}

/** The figures the source actually states, indexed by kind. */
interface SourceFigures {
  dates: Set<string>;
  versions: string[];
  numbers: Set<string>;
}

function indexFigures(text: string): SourceFigures {
  const index: SourceFigures = { dates: new Set(), versions: [], numbers: new Set() };
  for (const figure of extractFigures(text)) {
    if (figure.kind === 'date') index.dates.add(figure.canonical);
    else if (figure.kind === 'version') index.versions.push(figure.canonical);
    else index.numbers.add(figure.canonical);
  }
  return index;
}

function figureIsInSource(figure: Figure, index: SourceFigures): boolean {
  if (figure.kind === 'date') return index.dates.has(figure.canonical);
  if (figure.kind === 'number') return index.numbers.has(figure.canonical);
  // "29.0" grounds against a source that says "29.0.0": a shortened version is the same release,
  // while "29.0.1" still fails because no source version starts with it.
  return index.versions.some((v) => v === figure.canonical || v.startsWith(`${figure.canonical}.`));
}

/** The figures in a claim's wording that the source does not state anywhere. Set membership per
 * kind, not a substring test, so `29` in a claim is not "found" because the source has `1929`. */
export function findUngroundedFigures(text: string, sourceText: string): Figure[] {
  return ungroundedFromIndex(text, indexFigures(sourceText));
}

function ungroundedFromIndex(text: string, index: SourceFigures): Figure[] {
  return extractFigures(text).filter((figure) => !figureIsInSource(figure, index));
}

/** What happened to one claim:
 *  - `verified`: it cites a quote that was found in the source, and every number, version and
 *    date in its own wording is a figure the source states.
 *  - `unknown`: the model marked it unknown and cites no quote, so there is nothing to check.
 *  - `rejected`: it cites a quote that was NOT found in the source, or its wording states a
 *    figure the source does not, so it was removed.
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

function checkClaim(claim: Claim, normalizedSource: string, sourceFigures: SourceFigures): CheckResult {
  if (claim.unknown) {
    return { claim, status: 'unknown' };
  }
  const normalizedQuote = normalizeForMatch(claim.quote!);
  if (normalizedQuote.length === 0 || !normalizedSource.includes(normalizedQuote)) {
    return { claim: rejectedClaimPlaceholder('quote'), status: 'rejected' };
  }
  if (ungroundedFromIndex(claim.text, sourceFigures).length > 0) {
    return { claim: rejectedClaimPlaceholder('figures'), status: 'rejected' };
  }
  return { claim, status: 'verified' };
}

function checkAndCount(claim: Claim, normalizedSource: string, sourceFigures: SourceFigures, tally: Tally): Claim {
  const result = checkClaim(claim, normalizedSource, sourceFigures);
  tally.total++;
  tally[result.status]++;
  return result.claim;
}

function checkClaims(claims: Claim[], normalizedSource: string, sourceFigures: SourceFigures, tally: Tally): Claim[] {
  return claims.map((c) => checkAndCount(c, normalizedSource, sourceFigures, tally));
}

/**
 * The actual enforcement of Advisory Brief's core rule: this is CODE, not a model call,
 * deciding what survives into the brief a user sees. Every `Claim` with `unknown: false` must
 * carry a `quote` that is a real (normalized) substring of `sourceText`, or it's replaced with
 * a visible rejection placeholder. Every `urgency.deadlines` entry must likewise appear in the
 * source, or it's dropped from the list entirely (dates don't need a placeholder the way
 * claims do -- a missing date is just absent, not a broken sentence).
 *
 * This checks that quotes exist in the source and that a claim's own wording carries no figure
 * the source does not state. It does NOT check that a claim's wording is otherwise supported by
 * its quote -- a wrong word that contains no digits still passes -- and claims marked unknown are
 * counted separately because they carry nothing to check.
 */
export function verifyBrief(raw: RawBrief, sourceText: string, sourceUrl: string | null, sourceLabel: string): VerifiedBrief {
  const normalizedSource = normalizeForMatch(sourceText);
  const sourceFigures = indexFigures(sourceText);
  const tally: Tally = { total: 0, verified: 0, unknown: 0, rejected: 0 };

  const whatHappened = checkClaims(raw.whatHappened, normalizedSource, sourceFigures, tally);

  const urgencyReason = checkAndCount(raw.urgency.reason, normalizedSource, sourceFigures, tally);

  const affected: AudienceImpact[] = raw.affected.map((a) => ({
    ...a,
    explanation: checkAndCount(a.explanation, normalizedSource, sourceFigures, tally),
  }));

  const whatToTellYourTeam = checkClaims(raw.whatToTellYourTeam, normalizedSource, sourceFigures, tally);

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
