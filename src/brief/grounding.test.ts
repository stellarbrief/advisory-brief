import { describe, expect, it } from 'vitest';
import { isRemovedClaim, normalizeForMatch, REMOVED_CLAIM_TEXT, verifyBrief } from './grounding';
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

describe('verifyBrief figure check', () => {
  const withTeam = (text: string) =>
    minimalRawBrief({ whatToTellYourTeam: [claim(text, 'fixes recently identified vulnerabilities')] });

  it('removes and counts a claim whose text has a version not in the source', () => {
    const v = verifyBrief(withTeam('Upgrade to stellar-core 29.0.1 now.'), SOURCE, null, 'test');
    expect(isRemovedClaim(v.whatToTellYourTeam[0])).toBe(true);
    expect(v.verification.rejectedClaims).toBe(1);
  });

  it('removes a claim whose text has a number not in the source', () => {
    const v = verifyBrief(withTeam('Protocol 30 fixes the vulnerabilities.'), SOURCE, null, 'test');
    expect(v.verification.rejectedClaims).toBe(1);
  });

  it('keeps a claim whose figures all appear in the source', () => {
    const v = verifyBrief(withTeam('Upgrade to 29.0.0 before Protocol 29 goes live.'), SOURCE, null, 'test');
    expect(isRemovedClaim(v.whatToTellYourTeam[0])).toBe(false);
    expect(v.verification.rejectedClaims).toBe(0);
  });

  it('keeps a date the model reformatted when its digits are in the source', () => {
    // The source says "October 1st 1700 UTC"; the model wrote "Oct 1" and "01 October".
    for (const text of ['Mainnet vote is Oct 1 at 1700 UTC.', 'Mainnet vote is 01 October, 1700 UTC.']) {
      const v = verifyBrief(withTeam(text), SOURCE, null, 'test');
      expect(v.verification.rejectedClaims).toBe(0);
    }
  });

  it('removes a reformatted date whose day is wrong', () => {
    const v = verifyBrief(withTeam('Mainnet vote is Oct 2 at 1700 UTC.'), SOURCE, null, 'test');
    expect(v.verification.rejectedClaims).toBe(1);
  });

  it('does not match a number inside a longer number', () => {
    const v = verifyBrief(withTeam('The 170 validators must upgrade.'), SOURCE, null, 'test');
    expect(v.verification.rejectedClaims).toBe(1);
  });

  it('does not check the text of a claim marked unknown', () => {
    const v = verifyBrief(
      minimalRawBrief({ whatToTellYourTeam: [claim('Maybe 12 nodes, unclear.', null, true)] }),
      SOURCE,
      null,
      'test',
    );
    expect(v.verification.rejectedClaims).toBe(0);
  });
});

describe('verifyBrief month-aware date check', () => {
  const withTeam = (text: string) =>
    minimalRawBrief({ whatToTellYourTeam: [claim(text, 'fixes recently identified vulnerabilities')] });

  it('rejects a claim whose day is right but month is wrong', () => {
    // Source says "October 1st"; the claim's only digit ("1") is present, but the month is not.
    const v = verifyBrief(withTeam('The deadline is November 1.'), SOURCE, null, 'test');
    expect(v.verification.rejectedClaims).toBe(1);
    expect(isRemovedClaim(v.whatToTellYourTeam[0])).toBe(true);
  });

  it('rejects a wrong month written as a short form', () => {
    const v = verifyBrief(withTeam('The deadline is Nov 1.'), SOURCE, null, 'test');
    expect(v.verification.rejectedClaims).toBe(1);
  });

  it('grounds a date written month-first with a short or full month name and an ordinal', () => {
    for (const text of [
      'Mainnet vote is October 1st at 1700 UTC.',
      'Mainnet vote is Oct 1 at 1700 UTC.',
      'Mainnet vote is Oct. 1 at 1700 UTC.',
    ]) {
      const v = verifyBrief(withTeam(text), SOURCE, null, 'test');
      expect(v.verification.rejectedClaims).toBe(0);
    }
  });

  it('grounds a date written day-first with and without an ordinal', () => {
    for (const text of [
      'Mainnet vote is 1 October at 1700 UTC.',
      'Mainnet vote is 1st October at 1700 UTC.',
      'Mainnet vote is 1 Oct at 1700 UTC.',
    ]) {
      const v = verifyBrief(withTeam(text), SOURCE, null, 'test');
      expect(v.verification.rejectedClaims).toBe(0);
    }
  });

  it('grounds a written date against an ISO date in the source', () => {
    const isoSource = 'The release ships on 2026-10-01.';
    const v = verifyBrief(
      minimalRawBrief({
        whatHappened: [claim('A release is scheduled.', null, true)],
        urgency: { level: 'ACT_BEFORE_DEADLINE', reason: claim('A deadline exists.', null, true), deadlines: [] },
        whatToTellYourTeam: [claim('The deadline is October 1 2026.', 'ships on 2026-10-01')],
      }),
      isoSource,
      null,
      'test',
    );
    expect(v.verification.rejectedClaims).toBe(0);
  });

  it('rejects a written date with the wrong month against an ISO date in the source', () => {
    const isoSource = 'The release ships on 2026-10-01.';
    const v = verifyBrief(
      minimalRawBrief({
        whatHappened: [claim('A release is scheduled.', null, true)],
        urgency: { level: 'ACT_BEFORE_DEADLINE', reason: claim('A deadline exists.', null, true), deadlines: [] },
        whatToTellYourTeam: [claim('The deadline is November 1 2026.', 'ships on 2026-10-01')],
      }),
      isoSource,
      null,
      'test',
    );
    expect(v.verification.rejectedClaims).toBe(1);
  });

  it('falls back to the digits-only check for a day with no month name', () => {
    // A bare day ("the 1") has no month name next to it, so it stays a digits-only comparison:
    // "1" is in the source, so the claim passes.
    const v = verifyBrief(withTeam('The vote happens on the 1.'), SOURCE, null, 'test');
    expect(v.verification.rejectedClaims).toBe(0);
  });

  it('does not reject a month name that has no day next to it', () => {
    // "October" alone has no day adjacent, so there is no month-day pair to compare and the claim
    // falls back to the digits-only check (here there are no digits at all).
    const v = verifyBrief(withTeam('This concerns the October release.'), SOURCE, null, 'test');
    expect(v.verification.rejectedClaims).toBe(0);
  });

  it('keeps a claim where a number is followed by the word "may"', () => {
    // "protocol 28 may ..." is ordinary advisory wording, not a day-first "28 May" date.
    const source = 'Validators on protocol 28 should upgrade soon.';
    const v = verifyBrief(
      minimalRawBrief({
        whatHappened: [claim('A release is scheduled.', null, true)],
        urgency: { level: 'MONITOR', reason: claim('Nothing urgent.', null, true), deadlines: [] },
        whatToTellYourTeam: [
          claim('Operators on protocol 28 may want to upgrade soon.', 'on protocol 28 should upgrade soon'),
        ],
      }),
      source,
      null,
      'test',
    );
    expect(v.verification.rejectedClaims).toBe(0);
    expect(isRemovedClaim(v.whatToTellYourTeam[0])).toBe(false);
  });

  it('still grounds a capitalized month-first "May N" date', () => {
    const source = 'The upgrade is scheduled for May 28.';
    const v = verifyBrief(
      minimalRawBrief({
        whatHappened: [claim('A release is scheduled.', null, true)],
        urgency: { level: 'MONITOR', reason: claim('Nothing urgent.', null, true), deadlines: [] },
        whatToTellYourTeam: [claim('The upgrade is scheduled for May 28.', 'scheduled for May 28')],
      }),
      source,
      null,
      'test',
    );
    expect(v.verification.rejectedClaims).toBe(0);
  });

  it('does not read a hyphenated word that starts with a month name as a month', () => {
    // "march-in" is one hyphenated word, not "March" next to a day, so it must not form a "3-10"
    // month-day pair that the source lacks.
    const source = 'The list contains 10 items.';
    const v = verifyBrief(
      minimalRawBrief({
        whatHappened: [claim('A release is scheduled.', null, true)],
        urgency: { level: 'MONITOR', reason: claim('Nothing urgent.', null, true), deadlines: [] },
        whatToTellYourTeam: [claim('The list contains 10 march-in items.', 'list contains 10')],
      }),
      source,
      null,
      'test',
    );
    expect(v.verification.rejectedClaims).toBe(0);
  });
});

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
