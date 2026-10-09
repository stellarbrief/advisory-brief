import { describe, expect, it } from 'vitest';
import { renderSourcesLine } from './sources-line';

describe('renderSourcesLine', () => {
  it('renders a markdown link when sourceUrl is set', () => {
    const line = renderSourcesLine({ sourceUrl: 'https://example.com/advisory', sourceLabel: 'Example advisory' });
    expect(line).toBe('Source: [Example advisory](https://example.com/advisory)');
  });

  it('escapes markdown delimiters in the label and URL', () => {
    const line = renderSourcesLine({
      sourceUrl: 'https://example.com/a_(b)',
      sourceLabel: 'v1 [hotfix] (members) \\',
    });
    expect(line).toBe('Source: [v1 \\[hotfix\\] (members) \\\\](https://example.com/a_%28b%29)');
  });

  it('renders the plain label with no link when sourceUrl is null', () => {
    const line = renderSourcesLine({ sourceUrl: null, sourceLabel: 'Members-only Discord announcement' });
    expect(line).toBe('Source: Members-only Discord announcement');
    expect(line).not.toContain('[');
  });
});
