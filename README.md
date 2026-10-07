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
- A claim the model marks `unknown` cites no quote, so there is nothing to check. These are
  counted separately from verified claims (the brief shows, for example, "7/11 claims have a
  quote found in the source. 4 marked unknown").
- Any date must itself appear in the source text, or it's dropped from the brief.
- **Figures in a claim's `text` are checked too.** Every number, version string (`29.0.0`) and
  date part in the plain-language `text` must appear in the source, or the whole claim is removed
  and counted like a claim with a bad quote. A written date is compared by its month and day
  together, so "Oct 1" for "October 1st" passes and "Nov 1" for "October 1st" does not; a day
  with no month name next to it still falls back to a digits-only comparison.
- `urgency.level` is a closed enum (`ACT_NOW` / `ACT_BEFORE_DEADLINE` / `MONITOR` /
  `NO_ACTION`), validated with zod, so the model can't invent a new severity label.

**What this does not guarantee.** The check proves a quote exists in the source. It does not
prove the plain-language `text` next to that quote is actually supported by it, so a claim can
carry a real quote and still be a poor paraphrase. The figure check only compares digits and
explicit month-day pairs: it cannot tell that a correct number is attached to the wrong thing,
still ignores spelled-out numbers ("twenty-nine") and a month name with no day next to it, and
does not apply to claims marked unknown. The `urgency.level` choice, the per-audience
YES/NO/UNCLEAR "affected" flags, and the `whatWeDontKnow` list are model judgments that are not
checked against the source at all. Treat a brief as a faster way to read the advisory, not a
substitute for reading it, and use the quotes to check anything you act on.

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

`/api/brief` has no authentication and no rate limiting, and every request spends the model API
key set in `.env`. This project is meant to run locally or on a private network. Do not expose
an instance publicly with a real key until rate limiting is added; it is tracked as an issue
in [`ISSUES_BACKLOG.md`](ISSUES_BACKLOG.md).

## How it works

- `src/brief/schema.ts` — the `Claim` primitive and the full brief schema (zod).
- `src/brief/grounding.ts` — the actual quote/date verification logic.
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
