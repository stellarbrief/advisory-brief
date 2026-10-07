import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast';
import { MINIMUM_TEXT_CONTRAST, URGENCY_PRESENTATIONS } from './urgency';

describe('contrastRatio', () => {
  it('is 21 for the extremes and 1 for identical colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#7f7f7f', '#7f7f7f')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#991b1b', '#fef2f2')).toBeCloseTo(contrastRatio('#fef2f2', '#991b1b'));
  });

  it('accepts shorthand hex', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(relativeLuminance('#ffffff'));
  });

  it('rejects something that is not a colour', () => {
    expect(() => contrastRatio('red', '#ffffff')).toThrow(/Not a hex colour/);
  });
});

/** The urgency badge is the one place this app carries meaning in colour, and jsdom cannot report
 * a class-resolved colour to axe, so the palette is stated in `src/ui/urgency.ts` and measured
 * here instead. Levels are keyed explicitly: a fifth `UrgencyLevel` would fail to typecheck
 * rather than slip past an unkeyed list of assertions. */
describe('urgency badge palette', () => {
  const levels = ['ACT_NOW', 'ACT_BEFORE_DEADLINE', 'MONITOR', 'NO_ACTION'] as const;

  it('clears WCAG AA contrast on every level', () => {
    for (const level of levels) {
      const { foreground, background } = URGENCY_PRESENTATIONS[level];
      expect(contrastRatio(foreground, background), level).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
    }
  });

  it('gives every level words, not just a colour', () => {
    for (const level of levels) {
      expect(URGENCY_PRESENTATIONS[level].label.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(levels.map((l) => URGENCY_PRESENTATIONS[l].label)).size).toBe(levels.length);
  });

  it('keeps the whole enum covered', () => {
    expect(Object.keys(URGENCY_PRESENTATIONS).sort()).toEqual([...levels].sort());
  });
});
