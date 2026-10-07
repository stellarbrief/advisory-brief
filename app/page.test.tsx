// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from './page';
import { URGENCY_PRESENTATIONS } from '@/src/ui/urgency';
import { REMOVED_CLAIM_TEXT, REMOVED_FIGURE_TEXT } from '@/src/brief/grounding';
import type { Claim, VerifiedBrief } from '@/src/brief/schema';

type Keyboard = Awaited<ReturnType<typeof userEvent.setup>>;

const SOURCE =
  'A new security-focused Protocol 29 release is out, with the Testnet vote scheduled for ' +
  'September 29th 1700 UTC and Mainnet on October 1st 1700 UTC. Stellar-core 29.0.0-3589.4eb833373 ' +
  'fixes recently identified vulnerabilities, which have not been exploited.';

function claim(text: string, quote: string | null): Claim {
  return { text, quote, unknown: quote === null };
}

/** A brief that exercises every render path the page has: a verified claim, an unknown claim, a
 * claim removed for its quote, one removed for its figures, a deadline, and a source link. */
function briefFor(level: VerifiedBrief['urgency']['level']): VerifiedBrief {
  return {
    whatHappened: [
      claim('A new security-focused Protocol 29 release is out.', 'A new security-focused Protocol 29 release is out'),
      { text: REMOVED_CLAIM_TEXT, quote: null, unknown: true },
    ],
    urgency: {
      level,
      reason: claim('Mainnet adopts the fix on a fixed date.', 'Mainnet on October 1st 1700 UTC'),
      deadlines: ['October 1st 1700 UTC'],
    },
    affected: [
      { audienceId: 'wallet', affected: 'UNCLEAR', explanation: claim('Ask your node provider.', null) },
      {
        audienceId: 'anchor',
        affected: 'YES',
        explanation: claim('Anchors running their own Horizon nodes must upgrade.', 'fixes recently identified vulnerabilities'),
      },
      {
        audienceId: 'fintech',
        affected: 'NO',
        explanation: claim('Nothing here changes a fintech integration.', 'fixes recently identified vulnerabilities'),
      },
      { audienceId: 'exchange', affected: 'YES', explanation: { text: REMOVED_FIGURE_TEXT, quote: null, unknown: true } },
    ],
    whatToTellYourTeam: [
      claim('Mainnet adopts it Oct 1 1700 UTC.', 'Mainnet on October 1st 1700 UTC'),
      claim('The vulnerabilities have not been exploited.', 'have not been exploited'),
      claim('Providers may already have upgraded; ask.', null),
    ],
    whatWeDontKnow: ['The advisory does not describe the vulnerabilities.'],
    verification: { totalClaims: 9, verifiedClaims: 6, unknownClaims: 1, rejectedClaims: 2, rejectedDates: [] },
    sourceUrl: 'https://example.org/advisory',
    sourceLabel: 'Stellar Discord announcement, Sept 24, 2026',
  };
}

/** Serve `brief` for POST /api/brief and one release for GET /api/sources/stellar-core, the way
 * the two routes do. Nothing here touches the network. */
function stubFetch(brief: VerifiedBrief) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/brief')) {
        return { ok: true, status: 200, json: async () => ({ brief }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          advisories: [{ text: SOURCE, sourceUrl: 'https://github.com/stellar/stellar-core/releases/tag/v29.0.0', sourceLabel: 'stellar/stellar-core v29.0.0' }],
        }),
      } as Response;
    })
  );
}

/** jsdom has no layout engine, so axe cannot read a class-resolved colour and its
 * `color-contrast` rule is disabled here. Contrast is instead asserted against the exact values
 * the badge renders, in `src/ui/contrast.test.ts`. Everything else axe checks is live. */
async function violationsOf(container: HTMLElement) {
  const { violations } = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return violations;
}

function report(violations: Awaited<ReturnType<typeof violationsOf>>): string {
  return violations.map((v) => `${v.id} (${v.impact}) ${v.help}: ${v.nodes.map((n) => n.html).join(' | ')}`).join('\n');
}

/** Tab until the target has focus, so the test proves the element is reachable from the keyboard
 * without pinning an exact number of presses. Fails loudly if it is never reachable. */
async function tabUntil(user: Keyboard, target: HTMLElement, within = 25): Promise<void> {
  for (let i = 0; i < within; i++) {
    await user.tab();
    if (document.activeElement === target) return;
  }
  throw new Error(`Could not reach "${target.getAttribute('aria-label') ?? target.textContent?.trim()}" by pressing Tab.`);
}

/** Copying is asserted through `navigator.clipboard.readText()` rather than a mock of
 * `writeText`: `userEvent.setup()` installs its own clipboard stub on `window.navigator`, which
 * shadows any stub the test file attaches first, and reading the text back checks what actually
 * landed on the clipboard instead of only that a function was called. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('automated accessibility check on the brief view (axe-core)', () => {
  it('reports no violations on the empty form', async () => {
    const { container } = render(<Home />);
    const violations = await violationsOf(container);
    expect(violations, report(violations)).toEqual([]);
  });

  for (const level of Object.keys(URGENCY_PRESENTATIONS) as VerifiedBrief['urgency']['level'][]) {
    it(`reports no violations on a generated brief at urgency ${level}`, async () => {
      stubFetch(briefFor(level));
      const user = userEvent.setup();
      const { container } = render(<Home />);
      await user.type(screen.getByLabelText('Advisory text'), SOURCE);
      await user.click(screen.getByRole('button', { name: 'Generate brief' }));
      await screen.findByRole('heading', { name: 'Brief' });
      const violations = await violationsOf(container);
      expect(violations, report(violations)).toEqual([]);
    });
  }
});

describe('what the accessibility pass fixed', () => {
  it('labels each field rather than relying on placeholder text', () => {
    render(<Home />);
    expect(screen.getByLabelText('Advisory text').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Source URL').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Source label').tagName).toBe('INPUT');
  });

  it('states urgency in words, not by colour alone', async () => {
    stubFetch(briefFor('ACT_BEFORE_DEADLINE'));
    const user = userEvent.setup();
    render(<Home />);
    await user.type(screen.getByLabelText('Advisory text'), SOURCE);
    await user.click(screen.getByRole('button', { name: 'Generate brief' }));
    expect((await screen.findByText('Act before a deadline')).tagName).toBe('SPAN');
    expect(screen.queryByText('ACT_BEFORE_DEADLINE')).toBeNull();
  });

  it('exposes which audience is selected, and the panel that follows it', async () => {
    stubFetch(briefFor('MONITOR'));
    const user = userEvent.setup();
    render(<Home />);
    await user.type(screen.getByLabelText('Advisory text'), SOURCE);
    await user.click(screen.getByRole('button', { name: 'Generate brief' }));
    await screen.findByRole('heading', { name: 'Brief' });

    const wallet = screen.getByRole('button', { name: 'Wallet' });
    const anchor = screen.getByRole('button', { name: 'Anchor' });
    // The panel that follows the selection, scoped so the claim text below is this audience's
    // rather than any other section's.
    const affected = screen
      .getByRole('heading', { name: 'Are you affected?' })
      .closest('section') as HTMLElement;
    expect(wallet.getAttribute('aria-pressed')).toBe('true');
    expect(within(affected).getByText('Unclear from the source.')).toBeTruthy();

    await user.click(anchor);
    expect(anchor.getAttribute('aria-pressed')).toBe('true');
    expect(wallet.getAttribute('aria-pressed')).toBe('false');
    expect(within(affected).getByText(/Anchors running their own Horizon nodes/)).toBeTruthy();
    expect(within(affected).queryByText('Unclear from the source.')).toBeNull();
  });

  it('announces an error, and the result of copying, through live regions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: 'Rate limit reached.' }) }) as Response)
    );
    const user = userEvent.setup();
    render(<Home />);
    await user.type(screen.getByLabelText('Advisory text'), SOURCE);
    await user.click(screen.getByRole('button', { name: 'Generate brief' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Rate limit reached.');

    stubFetch(briefFor('NO_ACTION'));
    await user.click(screen.getByRole('button', { name: 'Generate brief' }));
    await screen.findByRole('heading', { name: 'Brief' });
    await user.click(screen.getByRole('button', { name: 'Copy as Markdown' }));
    expect((await screen.findByText('Copied Markdown to clipboard.')).textContent).toContain('Copied Markdown');
    expect(await navigator.clipboard.readText()).toContain('## Urgency: NO_ACTION');
  });
});

describe('the whole flow with the keyboard only', () => {
  it('loads a release, generates, switches audience and copies without a pointer', async () => {
    stubFetch(briefFor('ACT_BEFORE_DEADLINE'));
    const user = userEvent.setup();
    render(<Home />);

    const textarea = screen.getByLabelText('Advisory text') as HTMLTextAreaElement;
    const loadRelease = screen.getByRole('button', { name: 'Load latest stellar-core release' });
    await tabUntil(user, loadRelease);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(textarea.value).toContain('Protocol 29'));

    // The generate button only becomes reachable once there is text to submit.
    const generate = screen.getByRole('button', { name: 'Generate brief' });
    await tabUntil(user, generate);
    await user.keyboard('{Enter}');

    const results = await screen.findByRole('heading', { name: 'Brief' });
    expect(document.activeElement).toBe(results);

    const anchor = screen.getByRole('button', { name: 'Anchor' });
    await tabUntil(user, anchor);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(anchor.getAttribute('aria-pressed')).toBe('true'));

    const copy = screen.getByRole('button', { name: 'Copy for Slack' });
    await tabUntil(user, copy);
    await user.keyboard('{Enter}');
    await screen.findByText('Copied Slack message to clipboard.');
    expect(await navigator.clipboard.readText()).toContain('Urgency: ACT_BEFORE_DEADLINE');
  });
});
