# Architecture

## Data flow

1. A user pastes text, or the UI/CLI calls an `AdvisorySource.fetchLatest()` (`src/sources/`).
2. The raw text + optional source URL/label are POSTed to `/api/brief` (`app/api/brief/route.ts`),
   which first spends a slot in the per-address rate limit (see "Rate limiting `/api/brief`") and
   answers 429 if the window is used up.
3. `generateBrief` (`src/brief/generate.ts`) calls the Anthropic API with a native
   structured-output constraint: the JSON Schema is generated directly from `RawBriefSchema`
   (`src/brief/schema.ts`) via zod v4's `z.toJSONSchema`, so the model's contract and the
   validation schema can never drift apart.
4. The raw, schema-conformant response is parsed with `RawBriefSchema.parse` (shape-only
   validation — this does NOT mean every quote is real).
5. `verifyBrief` (`src/brief/grounding.ts`) is the actual enforcement, in two passes per claim:
   every claim's `quote` is checked as a real (whitespace/case-normalized) substring of the
   source text, and then every number, version and date in the claim's own `text` is checked
   against the set of such figures the source states. A claim that fails either is replaced with
   a visible rejection placeholder naming which check failed, not silently dropped, and counted in
   `rejectedClaims`. Figures are compared as whole, canonicalized tokens (`29` is not satisfied by
   a source containing `1929`; `Oct 1` and `October 1st` are the same date), because a real run
   produced a correct date the model had reformatted. Every date in `urgency.deadlines` is checked
   the same way as the quotes.
6. The resulting `VerifiedBrief` (schema-valid AND grounding-verified) is the only thing the
   UI ever renders.

## Why grounding is enforced in code, not just requested in the prompt

A sufficiently well-crafted prompt can reduce hallucination, but it cannot eliminate it, and it
cannot prove after the fact that a given claim was real. Asking the model to also return the
literal source substring behind every claim makes the quote checkable with a cheap,
deterministic, testable substring match that doesn't depend on the model's honesty on any given
call. That covers the quote only. The plain-language `text` written next to it is still the
model's wording, and a real run has produced a claim ("security … improvements") that its quote
did not support, and a claim that cited a real quote while naming a version the source never
mentioned. Extracting the digit-bearing facts from `text` and requiring the source to state them
closes that second gap mechanically: versions, dates and quantities are exactly the figures a
wrong paraphrase tends to get wrong, and they are the ones a deterministic check can name.
It is a floor, not an entailment check — see the limits recorded in the README's "What 'grounded'
means here" section. See `src/brief/grounding.test.ts` for the tests exercising both passes, and
the evaluation-harness issue in `ISSUES_BACKLOG.md` for measuring the rest.

## Why native structured outputs, not tool-use

Claude's API also supports forcing structured output via a fake "tool call" (`tool_choice`).
This project uses the newer, more direct `output_config.format` (JSON Schema) constraint
instead — see `src/brief/generate.ts`'s module comment and
[the structured-outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
Both approaches produce a schema-conformant response; grounding verification still applies
identically to either.

## Rate limiting `/api/brief`

`src/api/rate-limit.ts` holds a fixed-window counter in the process's memory, keyed by client
address, and `app/api/brief/route.ts` consults it as the first thing it does — before parsing the
body, so a flood cannot make the route do other work and every request that reaches the route
spends a slot. Over the limit (default 10 per minute, set by `BRIEF_RATE_LIMIT_REQUESTS` and
`BRIEF_RATE_LIMIT_WINDOW_SECONDS`) the route returns 429 with a `Retry-After` header and a message
a person can act on.

**Why this mechanism.** The thing worth protecting is the model API key, and the only deployment
target this project documents is a self-hosted instance running `npm run start`. In that setting a
counter in memory needs no Redis, no cloud vendor and no second service to run, and it is enough
for its actual job: stopping a browser tab, a loop or a script from draining a budget. Anything
stronger would be infrastructure the project does not need, so the limits are recorded here rather
than papered over:

- The count is per process. A restart resets it, and N instances allow N times the limit. If a
  deployment scales past one instance, the limiter needs a shared store (Redis or the platform's
  own edge limiter) behind the same `RateLimiter` interface — `check(key, at)` is the only
  contract the route depends on.
- The address comes from `X-Forwarded-For` (then `X-Real-IP`), which is only trustworthy when the
  proxy in front of the app *sets* it. A caller who can reach the app directly can invent a new
  address per request, and with no proxy header at all every client shares one bucket. So this is
  a loop breaker, not an abuse barrier; authentication in front is still the answer for anything
  publicly reachable.
- Fixed windows allow a burst at a window boundary (20 requests can land across two windows for a
  limit of 10). A sliding window or token bucket costs more state for a protection that does not
  need that precision here.
- Expired entries are swept once per window, so invented keys cannot grow the map with traffic.

**Why in the route handler, not `proxy.ts`** (Next.js 16's name for `middleware.ts`, per
`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`). A proxy would run before the
handler and could reject cheaper, but it is a separate execution context whose module state is not
shared with the handler in some runtimes — the exact "one counter per process" assumption above
would become "one counter per isolate, plus another in the handler". The route is where the key is
spent, so that is where the counter lives. `GET /api/sources/stellar-core` is deliberately not
limited: it costs GitHub's unauthenticated 60 requests/hour, which GitHub enforces for us.

## Accessibility on the brief view

Three problems were real, and each is now covered by something that runs in `npm test`:

- **Urgency was colour.** The badge's four palettes live in `src/ui/urgency.ts` as plain hex
  values, and the words beside them (`Act now`, `Act before a deadline`, `Monitor`, `No action
  needed`) carry the meaning, so the level survives greyscale and colour-blindness. Because the
  values are data, `src/ui/contrast.ts` can compute the WCAG relative-luminance ratio for each
  foreground/background pair and `src/ui/contrast.test.ts` fails if any drops under 4.5:1 —
  a contrast regression is a test failure, not a review comment. Had the colours stayed Tailwind
  class names, nothing in the test run could have read them.
- **The dark-mode canvas override was removed.** `app/globals.css` used to flip the page canvas to
  `#0a0a0a` under `prefers-color-scheme: dark` while the rest of the page (borders, `bg-gray-100`
  chips, grey body text) stayed light-only, which produced contrast ratios well below AA for
  anyone whose OS asked for dark. `color-scheme: light` now tells the browser to keep form
  controls light too. Real dark mode is a separate, larger piece of work.
- **Focus and names.** Every field has a visible `<label htmlFor>` rather than placeholder-only
  text, the audience buttons are a labelled `role="group"` with `aria-pressed`, errors are
  `role="alert"` and busy/copy status is an always-mounted `role="status"` (a live region that
  appears only when there is something to announce is not announced), the generated panel is
  `aria-labelledby` its own heading, and that heading takes focus when a brief arrives so a
  keyboard and screen-reader user is not left at the button they just pressed.

`app/page.test.tsx` runs axe-core over the rendered page — the empty form, and a generated brief at
each of the four urgency levels — and asserts zero violations, plus a test that drives the whole
flow (load release, generate, switch audience, copy) with Tab and Enter only.

**What the automated check cannot see.** jsdom has no layout engine, so axe's `color-contrast` rule
is disabled in these tests: it needs computed styles and geometry, and reports "incomplete" rather
than a verdict on every element. Contrast is covered by the explicit-value tests above instead, and
everything else axe does (names, roles, structure, duplicate ids, label associations) is live. axe
also only knows what it is given a DOM: the fixtures render each claim state once, so a violation
that needs real text measurement, a hovered state, or a viewport narrower than the layout is not
caught here.

## Extension points

- **Sources** (`src/sources/`): implement `AdvisorySource` (`id`, `name`, `fetchLatest()`).
  See [`ADDING_A_SOURCE.md`](ADDING_A_SOURCE.md).
- **Audiences** (`src/audiences/`): add a JSON profile. See
  [`ADDING_AN_AUDIENCE.md`](ADDING_AN_AUDIENCE.md).

Neither extension point requires touching `src/brief/` (the grounding/generation core) at all.
