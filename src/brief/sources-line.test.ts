import { describe, expect, it } from 'vitest';
import { renderSourcesLine } from './sources-line';

describe('renderSourcesLine', () => {
  it('renders a markdown link when sourceUrl is set', () => {
    const line = renderSourcesLine({ sourceUrl: 'https://example.com/advisory', sourceLabel: 'Example advisory' });
    expect(line).toBe('Source: [Example advisory](https://example.com/advisory)');
  });

  it('renders the plain label with no link when sourceUrl is null', () => {
    const line = renderSourcesLine({ sourceUrl: null, sourceLabel: 'Members-only Discord announcement' });
    expect(line).toBe('Source: Members-only Discord announcement');
    expect(line).not.toContain('[');
  });
});

// How the expected lines below were checked: each was rendered with commonmark.js 0.31.2, the
// reference implementation of the CommonMark spec, and came out as exactly one link with the
// original text and the original address. The unescaped versions did not (the comments say how).
describe('renderSourcesLine with characters that are special in a Markdown link', () => {
  const url = 'https://example.com/a';

  it('escapes square brackets in the label, which would otherwise end or restart the link text', () => {
    expect(renderSourcesLine({ sourceUrl: url, sourceLabel: 'stellar-core release v29 [hotfix]' })).toBe(
      'Source: [stellar-core release v29 \\[hotfix\\]](https://example.com/a)'
    );
    // Unescaped, "a]b[c" rendered as a link whose text was just "c".
    expect(renderSourcesLine({ sourceUrl: url, sourceLabel: 'a]b[c' })).toBe('Source: [a\\]b\\[c](https://example.com/a)');
  });

  it('escapes a backslash in the label, which at the end would swallow the closing bracket', () => {
    // Unescaped, this rendered no link at all.
    expect(renderSourcesLine({ sourceUrl: url, sourceLabel: 'ends with a backslash \\' })).toBe(
      'Source: [ends with a backslash \\\\](https://example.com/a)'
    );
  });

  it('leaves parentheses in the label alone: they are not special inside the link text', () => {
    expect(renderSourcesLine({ sourceUrl: url, sourceLabel: 'Discord #announcements (members)' })).toBe(
      'Source: [Discord #announcements (members)](https://example.com/a)'
    );
  });

  it('escapes parentheses in the URL, so a Wikipedia-style address and an unbalanced one both work', () => {
    expect(renderSourcesLine({ sourceUrl: 'https://en.wikipedia.org/wiki/Foo_(bar)', sourceLabel: 'x' })).toBe(
      'Source: [x](https://en.wikipedia.org/wiki/Foo_\\(bar\\))'
    );
    // Unescaped, this rendered a link to "https://example.com/a" only: the rest was cut off.
    expect(renderSourcesLine({ sourceUrl: 'https://example.com/a)b(c', sourceLabel: 'x' })).toBe(
      'Source: [x](https://example.com/a\\)b\\(c)'
    );
  });

  it('writes a space or other control character in the URL as the percent form of the same address', () => {
    // Unescaped, a space in the address rendered no link at all.
    expect(renderSourcesLine({ sourceUrl: 'https://example.com/a b', sourceLabel: 'x' })).toBe(
      'Source: [x](https://example.com/a%20b)'
    );
    expect(renderSourcesLine({ sourceUrl: 'https://example.com/a\tb\nc', sourceLabel: 'x' })).toBe(
      'Source: [x](https://example.com/a%09b%0Ac)'
    );
    expect(renderSourcesLine({ sourceUrl: 'https://example.com/<a>', sourceLabel: 'x' })).toBe(
      'Source: [x](https://example.com/%3Ca%3E)'
    );
  });

  it('escapes a backslash in the URL', () => {
    expect(renderSourcesLine({ sourceUrl: 'https://example.com/a\\b', sourceLabel: 'x' })).toBe(
      'Source: [x](https://example.com/a\\\\b)'
    );
  });

  it('does not touch the plain label when there is no link', () => {
    expect(renderSourcesLine({ sourceUrl: null, sourceLabel: 'v1 [hotfix] (members)' })).toBe(
      'Source: v1 [hotfix] (members)'
    );
  });
});
