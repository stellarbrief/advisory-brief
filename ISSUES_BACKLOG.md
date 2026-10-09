# Issues backlog

Candidate issues, each written to be posted to GitHub as-is. Every entry states the current
state at a specific commit, what to build, how to verify it, and what is out of scope.
Complexity (Trivial / Medium / High) follows the tiers in [`CONTRIBUTING.md`](CONTRIBUTING.md).
If you pick one up, follow "Picking up an issue" in [`CONTRIBUTING.md`](CONTRIBUTING.md).
Entries marked **Posted on GitHub** name the issue, and the GitHub issue is the source of truth for its status:
comment there, not here. This file keeps the original write-up and is not updated when an issue closes, and an
issue opened some other way may not be listed here at all. The rest are candidates that have not been posted yet.

Audited commit: `6e63cb2`

Anything that calls a real model needs your own `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`. The
test suite never does; it mocks the model and GitHub.

---

### 1. Build an evaluation harness that scores briefs against hand-written gold briefs
**Complexity:** High
**Posted on GitHub:** #17

**Description**
The only evidence that briefs are good is one live run that verified 10 of 10 quotes. That
checks quotes, not whether the brief is right (correct urgency, correct "affected" calls).

**Current state**
`src/brief/generate.test.ts` tests the pipeline against a mocked model. There is no set of real
advisories with known-good expected briefs and no scoring.

**What to build**
An `eval/` directory with at least five real advisory or release texts (for example past
`stellar/stellar-core` release bodies, copied verbatim with their URLs), each with a
hand-written expected urgency level and expected per-audience YES/NO/UNCLEAR calls. An
`npm run eval` script runs the real generator against each and reports urgency accuracy, audience
accuracy, and the share of claims whose quote was found.

A concrete first case: for the `stellar/stellar-core` v29.0.0 release notes (a plain changelog),
a real run produced "Security or stability improvements were made to the outbound queue load
shedding and handshake authentication". Its quote was found in the source, but the source never
says "security". A later run on the same text produced "security-related adjustments such as
stopping message reading during the auth handshake", where the source says only "Don't read
messages during auth handshake". The gold expectation for that case should flag a claim that
characterizes the changes as security-related when the source does not. Two runs, same text, same
embellishment, different wording: a good sign this needs measuring, not guessing.

**Acceptance criteria**
- [ ] At least five real source texts with hand-written expectations, sources cited.
- [ ] `npm run eval` prints per-case and aggregate results.
- [ ] It is separate from `npm test` and not run in CI (it spends real tokens), and says so in the docs.
- [ ] No score is hard-coded; results come from real runs.

**Out of scope**
Judging the prose quality of claim text. Running the eval in CI.

**Verification**
`npm run eval` with your own API key. Paste the output in the PR.

---

### 2. Rate-limit `/api/brief`
**Complexity:** High
**Posted on GitHub:** #8

**Description**
The route is unauthenticated and every request spends the configured model key. Anyone who
hosts an instance publicly can have their budget drained.

**Current state**
`app/api/brief/route.ts` validates the body (20,000 character cap) and calls the model. There is
no authentication or rate limiting. The README's "Deployment note" says to run it locally or on
a private network.

**What to build**
A rate limiter in front of the route, keyed by client address at minimum, with a clear 429
response. Pick the simplest mechanism that works for a self-hosted deployment, and explain the
choice in `docs/ARCHITECTURE.md` (an in-memory limiter does not survive multiple instances).

**Acceptance criteria**
- [ ] Requests over the limit get HTTP 429 with a readable message.
- [ ] The limit resets after its window, covered by a test using a fake clock.
- [ ] The README's "Deployment note" is updated to describe what is and isn't protected.

**Out of scope**
User accounts or API keys. Billing.

**Verification**
`npm test`.

---

### 3. Reject claim text whose numbers, versions or dates are not in the source
**Complexity:** Medium
**Posted on GitHub:** #6

**Description**
The verifier proves each claim's `quote` is in the source, but not that the claim's own `text`
agrees with it. A claim can attach a real quote and still state a wrong version number or date.
A cheap, deterministic check closes part of that gap.

**Current state**
`src/brief/grounding.ts` checks `quote` as a substring of the source and checks
`urgency.deadlines` entries. The `text` field is never compared with the source. The README's
"What 'grounded' means here" section documents this limit.

**What to build**
For each claim, extract digit sequences, version-like strings (`29.0.0`) and dates from `text`,
and require each to appear in the normalized source. A claim that fails is treated like a
rejected claim and counted in the verification summary.

**Acceptance criteria**
- [ ] A claim whose text contains a number not present in the source is removed and counted.
- [ ] A claim whose figures all appear in the source is unaffected.
- [ ] Tests use a real-shaped fixture, including a date the model reformatted (the case seen in a real run).
- [ ] The README's limits section is updated to say what the new check does and does not cover.

**Out of scope**
Semantic or model-based entailment checking.

**Verification**
`npm test`.

---

### 4. Add `stellar-rpc` and `stellar/go` (Horizon) release sources, with a source picker
**Complexity:** Medium

**Description**
Only `stellar/stellar-core` releases can be loaded today. Horizon and RPC operators are a core
audience for these advisories.

**Current state**
`src/sources/github-releases.ts` has a generic `createGitHubReleasesSource(owner, repo)` and
one export, `stellarCoreReleasesSource`. It is wired through `app/api/sources/stellar-core/route.ts`
and one hardcoded button in `app/page.tsx`. `docs/ADDING_A_SOURCE.md` describes the pattern.

**What to build**
Sources for `stellar/stellar-rpc` and `stellar/go`. Horizon releases live in the multi-product
`stellar/go` repository and use their own tag format, so check the real GitHub API response and
filter on what you actually see rather than assuming a pattern. Replace the single button with
a source picker backed by one generic route. Keep the existing stellar-core route working.

**Acceptance criteria**
- [ ] Each new source has a mocked-fetch test using a real-shaped response and a failure case.
- [ ] The tag format you filter on is quoted from the real API in a code comment.
- [ ] The UI lists the sources and loads the latest release of the chosen one.

**Out of scope**
Sources that are not GitHub Releases (see the next issue).

**Verification**
`npm test`, then load each source in `npm run dev`.

---

### 5. Check whether the Stellar Development Foundation publishes an advisory feed, and add it if so
**Complexity:** Medium

**Description**
Releases are only one place advisories appear. An official announcement feed would be a better
source if it exists.

**Current state**
Only GitHub Releases are supported (`src/sources/github-releases.ts`). No other feed has been
evaluated.

**What to build**
First confirm whether an official feed (RSS or Atom) for protocol and security announcements
exists, and record the URL and its item shape. If it does, implement an `AdvisorySource` for it
with a parser tested against a real captured sample. If it does not, close this issue with that
finding written up in `docs/ADDING_A_SOURCE.md`.

**Acceptance criteria**
- [ ] The investigation's result (feed URL or "none found") is recorded in the PR or issue.
- [ ] If a feed exists: a mocked-fetch test using a real captured feed sample, and no invented `publishedAt`.

**Out of scope**
Scraping pages that are not a published feed. Discord or other chat sources.

**Verification**
`npm test`.

---

### 6. Accessibility pass on the brief view
**Complexity:** Medium
**Posted on GitHub:** #7

**Description**
The page has not been checked for keyboard use, screen readers or color contrast.

**Current state**
`app/page.tsx` has no `aria-*` attributes. The urgency badge uses color classes (`bg-red-100`,
`bg-amber-100`, and so on) and there is no automated accessibility check.

**What to build**
Fix the real problems you find (contrast on the urgency badges, keyboard order and focus for the
audience buttons, labels on the form fields and buttons) and add an automated check so they
don't regress. If that needs a new dependency, say why in the PR.

**Acceptance criteria**
- [ ] An automated check runs in `npm test` or CI and reports no serious violations.
- [ ] The whole flow (load, generate, switch audience, copy) works with the keyboard only.
- [ ] Urgency is not conveyed by color alone.

**Out of scope**
A redesign. Internationalization.

**Verification**
Run the automated check, then complete the flow without a mouse.

---

### 7. Let quote matching ignore Markdown formatting characters
**Complexity:** Medium
**Posted on GitHub:** #18

_Written against commit `3536451`; later commits may have moved things, so check the code first._

**Description**
GitHub release notes are Markdown, and a model tends to quote the rendered text. A quote that is
correct except for formatting characters is rejected, and a legitimate claim is removed from the
brief.

**Current state**
`normalizeForMatch` in `src/brief/grounding.ts` lowercases and collapses whitespace, and nothing
else. In a real run on the stellar-core v29.0.0 release notes, 2 of 11 claims were removed because
they cited `Full Changelog: https://github.com/stellar/stellar-core/compare/v28.0.1...v29.0.0`,
while the source reads `**Full Changelog**: https://github.com/stellar/stellar-core/compare/v28.0.1...v29.0.0`.
Both claims were reasonable ("review the full changelog"); only the `**` differed.

**What to build**
A small, documented normalization step applied to both the source and the quote before matching
that strips Markdown emphasis markers (`**`, `__`, `*`, `_`) and backticks. Decide what to include
and what not to, and explain in the PR why it does not weaken the check: a fabricated quote must
still be rejected.

**Acceptance criteria**
- [ ] A test using the real source text above and the real removed quote, which now matches.
- [ ] A test that a fabricated quote is still rejected, and that removing formatting characters
      cannot make two different sentences match.
- [ ] The list of ignored characters is in one place, with a comment, and the README's
      "What grounded means here" section mentions it.

**Out of scope**
Fuzzy or edit-distance matching. Semantic matching. Checking that a claim's wording is supported
by its quote.

**Verification**
`npm test`.
