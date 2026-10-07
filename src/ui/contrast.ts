/** Colour maths a test can use, because an automated accessibility check inside `npm test` runs
 * in jsdom, where there is no layout engine and therefore no way to measure a rendered colour.
 * Anything whose contrast the suite asserts has to be a value in code, not a utility class. */

function srgbChannel(value: number): number {
  return value <= 0.03928 ? value / 12.94 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function parseHex(hex: string): [number, number, number] {
  const withoutHash = hex.replace('#', '');
  const full =
    withoutHash.length === 3
      ? withoutHash
          .split('')
          .map((c) => c + c)
          .join('')
      : withoutHash;
  const digits = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(digits)) throw new Error(`Not a hex colour: ${hex}`);
  return [((digits >> 16) & 255) / 255, ((digits >> 8) & 255) / 255, (digits & 255) / 255];
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(srgbChannel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2.1 contrast ratio of two colours: 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
