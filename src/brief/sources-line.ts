import type { VerifiedBrief } from './schema';

/** Escapes a label so it stays the text of one Markdown link.
 *
 * Inside `[...]`, a `]` ends the link text early, a `[` can start a new one, and a backslash at
 * the end swallows the closing bracket. Each is escaped with a backslash, which CommonMark reads
 * back as the plain character. Parentheses and other punctuation are fine as they are. */
function escapeLinkText(label: string): string {
  return label.replace(/[\\[\]]/g, '\\$&');
}

/** Makes a URL safe to put between `(...)` of a Markdown link without changing where it points.
 *
 * - A space or other control character ends the link destination. None is valid in a URL, and
 *   the percent form is the same address, so they are written as `%20`, `%0A`, and so on.
 * - `<` and `>` are percent-encoded for the same reason.
 * - A parenthesis would end the destination if it were unbalanced, and a backslash would
 *   escape the next character, so those are backslash-escaped. CommonMark reads the escape
 *   back as the plain character, so the address is exactly the one that was given. */
function escapeLinkDestination(url: string): string {
  let escaped = '';
  for (const char of url) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) escaped += `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
    else if (char === '<') escaped += '%3C';
    else if (char === '>') escaped += '%3E';
    else if (char === '(' || char === ')' || char === '\\') escaped += `\\${char}`;
    else escaped += char;
  }
  return escaped;
}

/** Renders the brief's "Sources" line: a markdown link when `sourceUrl` is set, or the
 * plain label with no link when it's null -- e.g. for a members-only channel whose
 * link wouldn't resolve for most readers anyway.
 *
 * The label and URL come from the request, so they are escaped: a label such as
 * `release v29 [hotfix]` or a URL with a space or an unbalanced parenthesis would otherwise
 * break the link or send it somewhere else. The plain label is left as it is, because with no
 * link there is nothing for a bracket to break. */
export function renderSourcesLine(brief: Pick<VerifiedBrief, 'sourceUrl' | 'sourceLabel'>): string {
  if (brief.sourceUrl) {
    return `Source: [${escapeLinkText(brief.sourceLabel)}](${escapeLinkDestination(brief.sourceUrl)})`;
  }
  return `Source: ${brief.sourceLabel}`;
}
