import { AUDIENCES } from '../audiences/index';
import { isRemovedClaim, isRemovedFigureClaim } from './grounding';
import { renderSourcesLine } from './sources-line';
import type { Claim, VerifiedBrief } from './schema';

function audienceLabel(id: string): string {
  return AUDIENCES.find((a) => a.id === id)?.label ?? id;
}

/** Full Markdown rendering of a verified brief -- what "Copy as Markdown" puts on the
 * clipboard. Every claim's text is shown; a claim marked `unknown` reads as "(unclear from
 * the source)" rather than silently looking identical to a verified one. */
export function toMarkdown(brief: VerifiedBrief): string {
  const lines: string[] = [];

  lines.push('## What happened');
  for (const c of brief.whatHappened) lines.push(`- ${claimLine(c)}`);

  lines.push('', `## Urgency: ${brief.urgency.level}`);
  lines.push(claimLine(brief.urgency.reason));
  if (brief.urgency.deadlines.length > 0) {
    lines.push(`Deadlines: ${brief.urgency.deadlines.join(', ')}`);
  }

  lines.push('', '## Are you affected?');
  for (const a of brief.affected) {
    lines.push(`- **${audienceLabel(a.audienceId)}**: ${a.affected} — ${claimLine(a.explanation)}`);
  }

  lines.push('', '## What to tell your team');
  for (const c of brief.whatToTellYourTeam) lines.push(`- ${claimLine(c)}`);

  lines.push('', "## What we don't know");
  for (const item of brief.whatWeDontKnow) lines.push(`- ${item}`);

  lines.push(
    '',
    `## Verification`,
    `${brief.verification.verifiedClaims}/${brief.verification.totalClaims} claims have a quote found in the source and no figure the source does not state.` +
      (brief.verification.unknownClaims > 0
        ? ` ${brief.verification.unknownClaims} marked unknown (no quote to check).`
        : '') +
      (brief.verification.rejectedClaims > 0
        ? ` ${brief.verification.rejectedClaims} unverifiable claim(s) were removed.`
        : '')
  );

  lines.push('', renderSourcesLine(brief));

  return lines.join('\n');
}

function claimLine(c: Claim): string {
  if (isRemovedFigureClaim(c)) return '*(removed: its wording stated a number, version or date not in the source)*';
  if (isRemovedClaim(c)) return '*(removed: its quote could not be found in the source)*';
  return c.unknown ? `${c.text} *(unclear from the source)*` : c.text;
}

/** A shorter, flatter version for pasting into Slack -- no headings (Slack's mrkdwn doesn't
 * render `##`), condensed to the sections a teammate skimming a channel actually needs. */
export function toSlackMessage(brief: VerifiedBrief): string {
  const lines: string[] = [];
  lines.push(`*Urgency: ${brief.urgency.level}* — ${claimLine(brief.urgency.reason)}`);
  if (brief.urgency.deadlines.length > 0) {
    lines.push(`Deadline(s): ${brief.urgency.deadlines.join(', ')}`);
  }
  lines.push('');
  for (const c of brief.whatToTellYourTeam) lines.push(`• ${claimLine(c)}`);
  lines.push('', renderSourcesLine(brief));
  return lines.join('\n');
}
