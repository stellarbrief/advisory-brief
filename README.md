# Advisory Brief

Turn a Stellar security advisory or release announcement into a plain-language brief for
**non-engineers** — business owners, compliance leads, and product managers at wallets,
anchors, fintechs, and exchanges. Node operators already get advisories written for them;
everyone downstream of a node operator gets protocol jargon and has to translate it under
time pressure. This tool does that translation, and makes every factual claim in the brief
traceable to a quote in the source advisory.

**See a real run without an API key:** the
[Advisory Brief playground](https://stellarbrief.github.io/playground/advisory/) shows one recorded brief,
claim by claim, with each quote re-checked against the source.

## What "grounded" means here (and what it doesn't)

Most LLM summarizers will confidently restate, embellish, or hallucinate a plausible-sounding
detail. This tool adds a mechanical check against that, with deliberate limits:

- The model returns structured JSON, and every factual claim carries either a verbatim
  `quote` (≤25 words) or an explicit `unknown: true`.
- **Code, not the model, verifies every quote is a real substring of the source** (after
  whitespace/case normalization). A claim whose quote fails is stripped and counted in a
  "verification" summary shown to the user, not hidden. In its place the brief shows "Removed:
  its quote could not be found in the source", which is deliberately different from "Unclear
  from the source" (a claim the model itself marked unknown).
- **Every number, version and date in a claim's own wording must be a figure the source states.**
  A brief saying `stellar-core 29.0.1` over a source that only names `29.0.0` is removed and
  counted, exactly like a bad quote, and labelled "Removed: its wording stated a number, version
  or date not in the source". Numbers are matched as whole figures, so a `29` cannot pass because
  the source contains `1929`. Dates are matched by day and month, so a correctly-summarised
  "Oct 1" grounds a source that says "October 1st" — the year and any time beside it are checked
  as separate numbers.
- A claim the model marks `unknown` cites no quote, so there is nothing to check. These are
  counted separately from verified claims (the brief shows, for example, "7/11 claims have a
  quote found in the source and no figure the source does not state. 4 marked unknown").
- Any date must itself appear in the source text, or it's dropped from the brief.
- `urgency.level` is a closed enum (`ACT_NOW` / `ACT_BEFORE_DEADLINE` / `MONITOR` /
  `NO_ACTION`), validated with zod, so the model can't invent a new severity label.

**What this does not guarantee.** The checks prove a quote exists in the source and that the
claim's figures are figures the source states. They do not prove the rest of the plain-language
`text` next to that quote is supported by it, so a claim can carry a real quote and correct
numbers and still be a poor paraphrase (a wrong *word*, with no digits, is invisible to both
checks). Digits that happen to sit inside a build hash or version string count as "stated" — a
source containing `29.0.0-3589.4eb833373` will let a claim mention `3589` or `4`. The
`urgency.level` choice, the per-audience YES/NO/UNCLEAR "affected" flags, and the `whatWeDontKnow`
list are model judgments that are not checked against the source at all. Treat a brief as a faster
way to read the advisory, not a substitute for reading it, and use the quotes to check anything
you act on.

See [`src/brief/grounding.ts`](src/brief/grounding.ts) for the actual enforcement.

## Quickstart

```bash
git clone https://github.com/stellarbrief/advisory-brief.git
cd advisory-brief
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY, or GEMINI_API_KEY for a free-tier alternative
npm run dev
```

No Anthropic access? Get a free `GEMINI_API_KEY` at [aistudio.google.com](https://aistudio.google.com) — no card required — and put it in `.env` instead. `app/api/brief/route.ts` uses whichever one is set.

Open `http://localhost:3000`, click "Load latest stellar-core release" (it fetches the newest
stable release notes from GitHub), and click "Generate brief." You can also paste any advisory
text instead.

## Deployment note

`/api/brief` spends the model API key set in `.env` on every request, so it is rate limited: by
default 10 requests per minute per client address, then HTTP 429 with a `Retry-After` header and a
readable message. Tune it with `BRIEF_RATE_LIMIT_REQUESTS` and `BRIEF_RATE_LIMIT_WINDOW_SECONDS`.

**What is protected:** `POST /api/brief`, per client address, in the process that serves it.
**What is not:** there is still no authentication, no per-user or per-key budget, and no limit on
`GET /api/sources/stellar-core` (GitHub's own unauthenticated limit applies there). The counter
lives in memory, so a restart clears it and each instance or serverless isolate keeps its own
budget — two replicas allow 20 requests a minute. The address comes from `X-Forwarded-For`, which
is only trustworthy if the proxy in front of the app *sets* that header itself (the default on
Vercel, Railway and a correctly configured Nginx/Caddy). Behind a proxy that forwards a
client-supplied value, a caller can rotate addresses and get a fresh window; with no proxy header
at all, every client shares one bucket.

Run it locally or on a private network. Public exposure means putting authentication in front, as
well as the rate limiter — see the limiter's trade-offs in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## How it works

- `src/brief/schema.ts` — the `Claim` primitive and the full brief schema (zod).
- `src/brief/grounding.ts` — the actual verification logic: quotes as substrings of the source,
  and the numbers/versions/dates inside each claim's wording against the figures the source states.
- `src/api/rate-limit.ts` — the fixed-window, per-address limiter `/api/brief` runs first.
- `src/brief/generate.ts` — provider-agnostic prompt construction and orchestration, using a
  JSON Schema generated directly from the zod schema (so the model's contract and the
  validation schema can never drift apart).
- `src/brief/providers/` — the Anthropic and Gemini implementations, each using that SDK's own
  real native structured-output feature
  ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
  Gemini's `responseJsonSchema`) — not a tool-use/function-calling workaround.
- `src/sources/` — one file per input source (`manual-paste`, GitHub Releases for
  `stellar/stellar-core`), behind a common `AdvisorySource` interface. Adding a new source is
  a small, self-contained file — see [`ADDING_A_SOURCE.md`](docs/ADDING_A_SOURCE.md).
- `src/audiences/` — one JSON profile per audience (`wallet`, `anchor`, `fintech`,
  `exchange`). Adding a new audience is adding one JSON file — see
  [`ADDING_AN_AUDIENCE.md`](docs/ADDING_AN_AUDIENCE.md).

## Roadmap

See [`ISSUES_BACKLOG.md`](ISSUES_BACKLOG.md) for scoped, ready-to-pick-up issues, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the fuller design writeup.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, the PR flow, and how issues are rated.

## License

MIT — see [`LICENSE`](LICENSE).
