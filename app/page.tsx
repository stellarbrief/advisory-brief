'use client';

import { useEffect, useRef, useState } from 'react';
import { AUDIENCES, getAudience, withArticle } from '@/src/audiences/index';
import { toMarkdown, toSlackMessage } from '@/src/brief/format';
import { isRemovedClaim, isRemovedFigureClaim } from '@/src/brief/grounding';
import type { Claim, VerifiedBrief } from '@/src/brief/schema';
import type { Advisory } from '@/src/sources/types';
import { URGENCY_PRESENTATIONS } from '@/src/ui/urgency';

// Matches the request-size limit in app/api/brief/route.ts.
const MAX_SOURCE_CHARS = 20000;

/** Tailwind utility classes cannot be measured by the automated accessibility check (jsdom has no
 * layout engine), so the urgency badge's colours come from `src/ui/urgency.ts` instead, where
 * `src/ui/contrast.test.ts` can assert the pair clears WCAG AA. */
function UrgencyBadge({ level }: { level: VerifiedBrief['urgency']['level'] }) {
  const { label, foreground, background, border } = URGENCY_PRESENTATIONS[level];
  return (
    <span
      className="inline-block rounded border px-2 py-1 text-xs font-semibold"
      style={{ color: foreground, backgroundColor: background, borderColor: border }}
    >
      {label}
    </span>
  );
}

/** Shows a claim, telling apart the three reasons it can have no text: the model marked it
 * unknown (nothing to check), or the verifier removed it because its quote was not in the source,
 * or because its own wording stated a figure the source does not. */
function ClaimText({ claim, unclear = 'Unclear from the source.' }: { claim: Claim; unclear?: string }) {
  if (isRemovedFigureClaim(claim)) {
    return <em className="text-red-700">Removed: its wording stated a number, version or date not in the source.</em>;
  }
  if (isRemovedClaim(claim)) {
    return <em className="text-red-700">Removed: its quote could not be found in the source.</em>;
  }
  if (claim.unknown) {
    return <em className="text-gray-500">{unclear}</em>;
  }
  return <>{claim.text}</>;
}

/** Hand-written profile data from src/audiences, not model output and not derived from the
 * advisory, so it is labelled as general guidance rather than presented as a finding. */
function AudienceGuidance({ audienceId }: { audienceId: string }) {
  const audience = getAudience(audienceId);
  if (!audience) return null;
  return (
    <div className="mt-4 rounded bg-gray-50 p-3 text-sm">
      <p className="text-xs text-gray-500">
        General guidance for {withArticle(audience.label.toLowerCase())} — not taken from this advisory.
      </p>
      <p className="mt-2 font-medium">Questions to ask your team</p>
      <ul className="mt-1 list-disc pl-5">
        {audience.questionsToAsk.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
      <p className="mt-2 font-medium">Who to notify</p>
      <p className="mt-1">{audience.whoToNotify.join(', ')}</p>
      <p className="mt-2 font-medium">Infrastructure this often touches</p>
      <ul className="mt-1 list-disc pl-5">
        {audience.typicalInfrastructure.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function Home() {
  const [sourceText, setSourceText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [brief, setBrief] = useState<VerifiedBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAudience, setActiveAudience] = useState<string>('wallet');
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  // A keyboard or screen-reader user who pressed "Generate brief" should land at the result rather
  // than stay on a button that just changed label. Focusing the heading does that, and gives the
  // region a name to be read out.
  useEffect(() => {
    if (brief) resultsHeadingRef.current?.focus();
  }, [brief]);

  async function loadLatestRelease() {
    setLoadingRelease(true);
    setError(null);
    setBrief(null);
    try {
      const res = await fetch('/api/sources/stellar-core');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not load the latest stellar-core release.');
        return;
      }
      const latest = (data.advisories as Advisory[])[0];
      if (!latest) {
        setError('No stable stellar-core release with release notes was found.');
        return;
      }
      if (latest.text.length > MAX_SOURCE_CHARS) {
        setError(
          `The latest release notes are ${latest.text.length} characters, over the ${MAX_SOURCE_CHARS} limit. Paste the relevant part instead.`
        );
        return;
      }
      setSourceText(latest.text);
      setSourceUrl(latest.sourceUrl ?? '');
      setSourceLabel(latest.sourceLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingRelease(false);
    }
  }

  async function generate() {
    setLoading(true);
    setError(null);
    setBrief(null);
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText,
          sourceUrl: sourceUrl || null,
          sourceLabel: sourceLabel || 'Pasted advisory text',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.');
        return;
      }
      setBrief(data.brief as VerifiedBrief);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopyStatus(`Copied ${label} to clipboard.`);
    setTimeout(() => setCopyStatus(null), 2000);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold">Advisory Brief</h1>
      <p className="mt-2 text-sm text-gray-600">
        Turn a Stellar security advisory or release announcement into a plain-language brief for
        non-engineers. Each claim must carry a quote, and code checks that the quote appears in the
        source text and that the numbers, versions and dates in the claim itself are figures the
        source states; a claim that fails either is removed and counted, not hidden. Neither check
        proves the wording is a faithful paraphrase, so verify before acting.
      </p>

      <div className="mt-6 space-y-3">
        <div>
          <label htmlFor="source-text" className="block text-sm font-medium">
            Advisory text
          </label>
          <p id="source-text-hint" className="mt-1 text-xs text-gray-600">
            Paste the advisory or release announcement, up to {MAX_SOURCE_CHARS.toLocaleString('en-US')} characters.
          </p>
          <textarea
            id="source-text"
            aria-describedby="source-text-hint"
            className="mt-1 w-full rounded border border-gray-300 p-3 text-sm"
            rows={8}
            placeholder="Paste the advisory or release announcement text here..."
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="source-url" className="block text-sm font-medium">
              Source URL
            </label>
            <input
              id="source-url"
              className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
              placeholder="https://…"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="source-label" className="block text-sm font-medium">
              Source label
            </label>
            <input
              id="source-label"
              className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
              placeholder="e.g. Stellar Discord announcement"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={loading || sourceText.trim().length === 0}
            aria-busy={loading}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white enabled:hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
          >
            {loading ? 'Generating…' : 'Generate brief'}
          </button>
          <button
            type="button"
            onClick={loadLatestRelease}
            disabled={loadingRelease}
            aria-busy={loadingRelease}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 enabled:hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
          >
            {loadingRelease ? 'Loading…' : 'Load latest stellar-core release'}
          </button>
        </div>
        {/* Mounted before there is anything to say, so a screen reader reports the change instead
            of the region appearing already populated. */}
        <p role="status" className="text-sm text-gray-600">
          {loading ? 'Generating the brief.' : loadingRelease ? 'Loading the latest release notes.' : ''}
        </p>
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {brief && (
        <section aria-labelledby="brief-results-heading" className="mt-8 space-y-6 rounded border border-gray-200 p-5">
          <h2 id="brief-results-heading" ref={resultsHeadingRef} tabIndex={-1} className="font-semibold">
            Brief
          </h2>

          <section>
            <h2 className="font-semibold">What happened</h2>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {brief.whatHappened.map((c, i) => (
                <li key={i}><ClaimText claim={c} /></li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="urgency-heading">
            <h2 id="urgency-heading" className="font-semibold">Urgency</h2>
            <div className="mt-1">
              <UrgencyBadge level={brief.urgency.level} />
            </div>
            <p className="mt-2 text-sm"><ClaimText claim={brief.urgency.reason} unclear="Reason unclear from the source." /></p>
            {brief.urgency.deadlines.length > 0 && (
              <p className="mt-1 text-sm text-gray-600">Deadline(s): {brief.urgency.deadlines.join(', ')}</p>
            )}
          </section>

          <section>
            <h2 className="font-semibold">Are you affected?</h2>
            <div role="group" aria-label="Choose an audience" className="mt-2 flex gap-2">
              {AUDIENCES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setActiveAudience(a.id)}
                  aria-pressed={activeAudience === a.id}
                  className={`rounded px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    activeAudience === a.id ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {/* The buttons above only change what is selected; this says what the selection is
                for, so switching audience without looking is not a silent change. */}
            <div aria-live="polite">
              {brief.affected
                .filter((a) => a.audienceId === activeAudience)
                .map((a) => (
                  <div key={a.audienceId} className="mt-2 text-sm">
                    <span className="font-medium">{a.affected}</span> —{' '}
                    <ClaimText claim={a.explanation} />
                  </div>
                ))}
              <AudienceGuidance audienceId={activeAudience} />
            </div>
          </section>

          <section>
            <h2 className="font-semibold">What to tell your team</h2>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {brief.whatToTellYourTeam.map((c, i) => (
                <li key={i}><ClaimText claim={c} /></li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-semibold">What we don&apos;t know</h2>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {brief.whatWeDontKnow.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="border-t border-gray-200 pt-3 text-xs text-gray-500">
            {brief.verification.verifiedClaims}/{brief.verification.totalClaims} claims have a quote found in
            the source and no figure the source does not state.
            {brief.verification.unknownClaims > 0 &&
              ` ${brief.verification.unknownClaims} marked unknown (no quote to check).`}
            {brief.verification.rejectedClaims > 0 &&
              ` ${brief.verification.rejectedClaims} unverifiable claim(s) were removed.`}
            {brief.verification.rejectedDates.length > 0 &&
              ` ${brief.verification.rejectedDates.length} date(s) not found in the source were dropped.`}
          </section>

          <section className="text-xs text-gray-500">
            {brief.sourceUrl ? (
              <a href={brief.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                {brief.sourceLabel}
              </a>
            ) : (
              brief.sourceLabel
            )}
          </section>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => copy(toMarkdown(brief), 'Markdown')}
              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium enabled:hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Copy as Markdown
            </button>
            <button
              type="button"
              onClick={() => copy(toSlackMessage(brief), 'Slack message')}
              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium enabled:hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Copy for Slack
            </button>
          </div>
          <p role="status" className="text-xs text-green-700">{copyStatus}</p>
        </section>
      )}
    </main>
  );
}
