import type { VerifiedBrief } from './schema';

/** Renders the brief's "Sources" line: a markdown link when `sourceUrl` is set, or the
 * plain label with no link when it's null -- e.g. for a members-only channel whose
 * link wouldn't resolve for most readers anyway. */
export function renderSourcesLine(brief: Pick<VerifiedBrief, 'sourceUrl' | 'sourceLabel'>): string {
  if (brief.sourceUrl) {
    const escapedLabel = brief.sourceLabel.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    const escapedUrl = brief.sourceUrl.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
    return `Source: [${escapedLabel}](${escapedUrl})`;
  }
  return `Source: ${brief.sourceLabel}`;
}
