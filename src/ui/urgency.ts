import type { UrgencyLevel } from '../brief/schema';

/** How each urgency level is shown. The words are the message and are always rendered; the
 * colours are redundant reinforcement, so a reader who cannot distinguish `bg-red-100` from
 * `bg-amber-100` still gets "Act now" versus "Monitor".
 *
 * These are explicit colour values rather than Tailwind utility classes because the suite has to
 * measure them: an automated accessibility check in `npm test` runs in jsdom, which has no layout
 * engine and therefore cannot read a class-resolved colour. `src/ui/contrast.test.ts` asserts the
 * foreground/background pair clears WCAG AA for every level. */
export interface UrgencyPresentation {
  label: string;
  foreground: string;
  background: string;
  border: string;
}

export const URGENCY_PRESENTATIONS: Record<UrgencyLevel, UrgencyPresentation> = {
  ACT_NOW: { label: 'Act now', foreground: '#991b1b', background: '#fef2f2', border: '#fca5a5' },
  ACT_BEFORE_DEADLINE: {
    label: 'Act before a deadline',
    foreground: '#92400e',
    background: '#fef3c7',
    border: '#fcd34d',
  },
  MONITOR: { label: 'Monitor', foreground: '#1e40af', background: '#dbeafe', border: '#93c5fd' },
  NO_ACTION: { label: 'No action needed', foreground: '#166534', background: '#dcfce7', border: '#86efac' },
};

/** WCAG 2.1 AA for normal-sized text. */
export const MINIMUM_TEXT_CONTRAST = 4.5;
