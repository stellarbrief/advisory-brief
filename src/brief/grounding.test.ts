import { describe, expect, it } from 'vitest';
import {
  REMOVED_CLAIM_TEXT,
  REMOVED_FIGURE_TEXT,
  extractFigures,
  findUngroundedFigures,
  isRemovedClaim,
  isRemovedFigureClaim,
  normalizeForMatch,
  verifyBrief,
} from './grounding';
import type { RawBrief } from './schema';
import { RawBriefSchema, UrgencyLevel } from './schema';

const SOURCE =
  'A new security-focused Protocol 29 release is out, with the Testnet vote scheduled for ' +
  'September 29th 1700 UTC and Mainnet on October 1st 1700 UTC. Stellar-core 29.0.0-3589.4eb833373 ' +
  'fixes recently identified vulnerabilities, which to the best of our knowledge have not been ' +
  'exploited.';

function claim(text: string, quote: string | null, unknown = false) {
  return { text, quote, unknown };
}

function minimalRawBrief(overrides: Partial<RawBrief> = {}): RawBrief {
  const base: RawBrief = {
    whatHappened: [claim('A new Protocol 29 release is out.', 'A new security-focused Protocol 29 release is out')],
    urgency: {
      level: 'ACT_BEFORE_DEADLINE',
      reason: claim('There is a Mainnet vote deadline.', 'Mainnet on October 1st 1700 UTC'),
      deadlines: ['October 1st 1700 UTC'],
    },
    affected: (['wallet', 'anchor', 'fintech', 'exchange'] as const).map((audienceId) => ({
      audienceId,
      affected: 'UNCLEAR' as const,
      explanation: claim('Not enough information to say.', null, true),
    })),
    whatToTellYourTeam: [
      claim('Review the release.', 'fixes recently identified vulnerabilities'),
      claim('No known exploitation.', 'have not been exploited'),
      claim('Deadline is Oct 1.', 'Mainnet on October 1st 1700 UTC'),
    ],
    whatWeDontKnow: ['The advisory does not describe the vulnerabilities themselves.'],
  };
  return { ...base, ...overrides };
}

describe('verifyBrief', () => {
  it('keeps a claim whose quote is a real substring of the source', () => {
    const result = verifyBrief(minimalRawBrief(), SOURCE, null, 'test');
    expect(result.whatHappened[0].unknown).toBe(false);
    expect(result.verification.rejectedClaims).toBe(0);
  });

  it('counts found-quote, unknown and rejected claims separately, and they add up to the total', () => {
    // The fixture has 5 claims that cite a quote (whatHappened, the urgency reason and three
    // team items) and 4 audience claims marked unknown.
    const v = verifyBrief(minimalRawBrief(), SOURCE, null, 'test').verification;
    expect(v.totalClaims).toBe(9);
    expect(v.verifiedClaims).toBe(5);
    expect(v.unknownClaims).toBe(4);
    expect(v.rejectedClaims).toBe(0);
    expect(v.verifiedClaims + v.unknownClaims + v.rejectedClaims).toBe(v.totalClaims);
  });

  it('never counts a claim that cites no quote as verified', () => {
    const allUnknown = minimalRawBrief({
      whatHappened: [claim('Nothing stated.', null, true)],
      urgency: { level: 'MONITOR', reason: claim('Unclear.', null, true), deadlines: [] },
      whatToTellYourTeam: [
        claim('Unclear.', null, true),
        claim('Unclear.', null, true),
        claim('Unclear.', null, true),
      ],
    });
    const v = verifyBrief(allUnknown, SOURCE, null, 'test').verification;
    expect(v.verifiedClaims).toBe(0);
    expect(v.unknownClaims).toBe(v.totalClaims);
  });

  it('rejects a fabricated quote that never appears in the source', () => {
    const raw = minimalRawBrief({
      whatHappened: [claim('The sky is falling.', 'this text does not appear anywhere in the source')],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.whatHappened[0].unknown).toBe(true);
    expect(result.whatHappened[0].text).toMatch(/could not be verified/);
    expect(result.verification.rejectedClaims).toBe(1);
    expect(result.verification.verifiedClaims).toBe(4);
    expect(result.verification.unknownClaims).toBe(4);
  });

  it('tells a removed claim apart from a claim the model itself marked unknown', () => {
    const raw = minimalRawBrief({
      whatHappened: [claim('The sky is falling.', 'this text does not appear anywhere in the source')],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    // Both have no quote and unknown: true, but only the first was checked and failed.
    expect(isRemovedClaim(result.whatHappened[0])).toBe(true);
    expect(result.whatHappened[0].text).toBe(REMOVED_CLAIM_TEXT);
    for (const a of result.affected) {
      expect(a.explanation.unknown).toBe(true);
      expect(isRemovedClaim(a.explanation)).toBe(false);
    }
  });

  it('does not treat a verified claim as removed', () => {
    const result = verifyBrief(minimalRawBrief(), SOURCE, null, 'test');
    expect(isRemovedClaim(result.whatHappened[0])).toBe(false);
  });

  it('matches through whitespace and case normalization edge cases', () => {
    const raw = minimalRawBrief({
      whatHappened: [claim('Case/whitespace test.', 'STELLAR-CORE   29.0.0-3589.4EB833373\n\nFIXES')],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.whatHappened[0].unknown).toBe(false);
  });

  it('passes unknown claims through without requiring a source match', () => {
    const result = verifyBrief(minimalRawBrief(), SOURCE, null, 'test');
    // All four audience impacts in the fixture are marked unknown.
    for (const a of result.affected) {
      expect(a.explanation.unknown).toBe(true);
    }
    expect(result.verification.rejectedClaims).toBe(0);
  });

  it('drops a deadline date that does not appear in the source', () => {
    const raw = minimalRawBrief({
      urgency: {
        level: 'ACT_BEFORE_DEADLINE',
        reason: claim('Deadline exists.', 'Mainnet on October 1st 1700 UTC'),
        deadlines: ['October 1st 1700 UTC', 'November 15th 2026'],
      },
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.urgency.deadlines).toEqual(['October 1st 1700 UTC']);
    expect(result.verification.rejectedDates).toEqual(['November 15th 2026']);
  });

  it('keeps a deadline date that does appear in the source', () => {
    const result = verifyBrief(minimalRawBrief(), SOURCE, null, 'test');
    expect(result.urgency.deadlines).toEqual(['October 1st 1700 UTC']);
    expect(result.verification.rejectedDates).toEqual([]);
  });
});

/** Issue #6: a quote that exists only proves the model copied something. These exercise the
 * second check -- that the numbers, versions and dates in the claim's OWN wording are figures
 * the source states. The claims below all cite a real quote, so a failure here is the wording. */
describe('verifyBrief: figures in claim text', () => {
  it('removes a claim whose version is not the one the source names', () => {
    const raw = minimalRawBrief({
      whatHappened: [claim('Stellar-core 29.0.1 fixes them.', 'fixes recently identified vulnerabilities')],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.whatHappened[0].text).toBe(REMOVED_FIGURE_TEXT);
    expect(result.verification.rejectedClaims).toBe(1);
  });

  it('removes a claim whose date is not the one the source names', () => {
    const raw = minimalRawBrief({
      whatHappened: [claim('Mainnet adopts it on October 3rd.', 'Mainnet on October 1st 1700 UTC')],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(isRemovedFigureClaim(result.whatHappened[0])).toBe(true);
  });

  it('removes a claim that states a plain number the source never gives', () => {
    const raw = minimalRawBrief({
      whatHappened: [claim('35 validators must upgrade.', 'fixes recently identified vulnerabilities')],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.verification.rejectedClaims).toBe(1);
  });

  it('keeps a claim whose figures all appear in the source', () => {
    const raw = minimalRawBrief({
      whatHappened: [claim('Protocol 29 ships as stellar-core 29.0.0.', 'A new security-focused Protocol 29 release is out')],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.whatHappened[0].unknown).toBe(false);
    expect(result.whatHappened[0].text).toBe('Protocol 29 ships as stellar-core 29.0.0.');
    expect(result.verification.rejectedClaims).toBe(0);
  });

  it('keeps a date the model reformatted, which a literal substring comparison would reject', () => {
    // Seen in a real run: the source says "October 1st 1700 UTC", the brief says "Oct 1 1700 UTC".
    const raw = minimalRawBrief({
      whatHappened: [claim('Mainnet adopts it Oct 1 1700 UTC.', 'Mainnet on October 1st 1700 UTC')],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.whatHappened[0].unknown).toBe(false);
    expect(result.verification.rejectedClaims).toBe(0);
  });

  it('labels a figure removal differently from a quote removal', () => {
    const quoteBad = verifyBrief(
      minimalRawBrief({ whatHappened: [claim('It rained.', 'a quote that is not in the source')] }),
      SOURCE, null, 'test'
    );
    const figuresBad = verifyBrief(
      minimalRawBrief({ whatHappened: [claim('Version 29.0.1 ships.', 'fixes recently identified vulnerabilities')] }),
      SOURCE, null, 'test'
    );
    expect(isRemovedClaim(quoteBad.whatHappened[0])).toBe(true);
    expect(isRemovedFigureClaim(quoteBad.whatHappened[0])).toBe(false);
    expect(isRemovedClaim(figuresBad.whatHappened[0])).toBe(true);
    expect(isRemovedFigureClaim(figuresBad.whatHappened[0])).toBe(true);
  });

  it('does not figure-check a claim the model marked unknown', () => {
    const raw = minimalRawBrief({
      whatHappened: [claim('Probably 29.0.1, we cannot say.', null, true)],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.whatHappened[0].text).toBe('Probably 29.0.1, we cannot say.');
    expect(result.verification.rejectedClaims).toBe(0);
  });

  it('counts a figure rejection in the same tally as a quote rejection', () => {
    const raw = minimalRawBrief({
      whatToTellYourTeam: [
        claim('Deadline is Oct 1.', 'Mainnet on October 1st 1700 UTC'),
        claim('Stellar-core 29.0.1 fixes them.', 'fixes recently identified vulnerabilities'),
        claim('No known exploitation.', 'have not been exploited'),
      ],
    });
    const v = verifyBrief(raw, SOURCE, null, 'test').verification;
    expect(v.totalClaims).toBe(9);
    expect(v.verifiedClaims).toBe(4);
    expect(v.unknownClaims).toBe(4);
    expect(v.rejectedClaims).toBe(1);
    expect(v.verifiedClaims + v.unknownClaims + v.rejectedClaims).toBe(v.totalClaims);
  });

  it('rejects a claim whose quote is fine but whose date is invented, keeping the other claims', () => {
    const raw = minimalRawBrief({
      whatHappened: [
        claim('A new Protocol 29 release is out.', 'A new security-focused Protocol 29 release is out'),
        claim('A follow-up lands on November 15th.', 'fixes recently identified vulnerabilities'),
      ],
    });
    const result = verifyBrief(raw, SOURCE, null, 'test');
    expect(result.whatHappened[0].unknown).toBe(false);
    expect(result.whatHappened[1].text).toBe(REMOVED_FIGURE_TEXT);
  });
});

describe('extractFigures', () => {
  it('reads a dotted version as one figure, not as its component digits', () => {
    expect(extractFigures('stellar-core 29.0.0 is out')).toEqual([
      { raw: '29.0.0', kind: 'version', canonical: '29.0.0' },
    ]);
  });

  it('canonicalizes a month-name date whatever its order, abbreviation or ordinal suffix', () => {
    const dates = ['October 1st', '1 October', 'Sept. 29', 'oct 1'].map((t) => extractFigures(t));
    expect(dates.map((d) => d.map((f) => f.canonical))).toEqual([['10/1'], ['10/1'], ['9/29'], ['10/1']]);
  });

  it('leaves the year and time beside a date as separate numbers', () => {
    expect(extractFigures('Mainnet on October 1st 1700 UTC')).toEqual([
      { raw: 'october 1st', kind: 'date', canonical: '10/1' },
      { raw: '1700', kind: 'number', canonical: '1700' },
    ]);
  });

  it('treats thousands separators and leading zeros as the same number', () => {
    expect(extractFigures('1,024 and 0029 items').map((f) => f.canonical)).toEqual(['1024', '29']);
  });
});

describe('findUngroundedFigures', () => {
  it('compares whole numbers, so a claim cannot hide a digit inside a longer source number', () => {
    const bad = findUngroundedFigures('Upgrade 29 nodes.', 'The cluster was built in 1929.');
    expect(bad).toHaveLength(1);
    expect(bad[0].canonical).toBe('29');
  });

  it('accepts a version shortened from the one the source states', () => {
    expect(findUngroundedFigures('Use version 29.0.', 'Stellar-core 29.0.0 fixes it.')).toEqual([]);
  });

  it('accepts an ISO date that names the day the source spelled out', () => {
    expect(findUngroundedFigures('Deadline 2026-10-01.', 'The vote is on October 1st 2026.')).toEqual([]);
    expect(findUngroundedFigures('Deadline 2026-10-05.', 'The vote is on October 1st 2026.')).toHaveLength(1);
  });

  it('ignores a number that is only a digit inside a version the source states', () => {
    expect(findUngroundedFigures('Stellar-core 29.0.0-3589 fixes it.', 'Stellar-core 29.0.0-3589.4eb833373 fixes it.')).toEqual([]);
  });
});

describe('normalizeForMatch', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeForMatch('  Foo   Bar\n\nBaz  ')).toBe('foo bar baz');
  });
});

describe('schema validation', () => {
  it('rejects an urgency value outside the closed enum', () => {
    expect(() => UrgencyLevel.parse('SUPER_URGENT')).toThrow();
  });

  it('accepts every real urgency value', () => {
    for (const v of ['ACT_NOW', 'ACT_BEFORE_DEADLINE', 'MONITOR', 'NO_ACTION']) {
      expect(() => UrgencyLevel.parse(v)).not.toThrow();
    }
  });

  it('rejects a claim with both a quote and unknown: true', () => {
    const parsed = RawBriefSchema.safeParse(minimalRawBrief({
      whatHappened: [{ text: 'x', quote: 'y', unknown: true }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('rejects a claim with neither a quote nor unknown: true', () => {
    const parsed = RawBriefSchema.safeParse(minimalRawBrief({
      whatHappened: [{ text: 'x', quote: null, unknown: false }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('rejects a quote longer than 25 words', () => {
    const longQuote = new Array(26).fill('word').join(' ');
    const parsed = RawBriefSchema.safeParse(minimalRawBrief({
      whatHappened: [{ text: 'x', quote: longQuote, unknown: false }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('accepts a well-formed minimal brief', () => {
    const parsed = RawBriefSchema.safeParse(minimalRawBrief());
    expect(parsed.success).toBe(true);
  });
});
