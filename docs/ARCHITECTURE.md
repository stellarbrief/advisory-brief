# Architecture

## Data flow

1. A user pastes text, or the UI/CLI calls an `AdvisorySource.fetchLatest()` (`src/sources/`).
2. The raw text + optional source URL/label are POSTed to `/api/brief` (`app/api/brief/route.ts`).
3. `generateBrief` (`src/brief/generate.ts`) calls the Anthropic API with a native
   structured-output constraint: the JSON Schema is generated directly from `RawBriefSchema`
   (`src/brief/schema.ts`) via zod v4's `z.toJSONSchema`, so the model's contract and the
   validation schema can never drift apart.
4. The raw, schema-conformant response is parsed with `RawBriefSchema.parse` (shape-only
   validation — this does NOT mean every quote is real).
5. `verifyBrief` (`src/brief/grounding.ts`) is the actual enforcement: every claim's `quote` is
   checked as a real (whitespace/case-normalized) substring of the source text. A claim that
   fails is replaced with a visible rejection placeholder, not silently dropped. Every date in
   `urgency.deadlines` is checked the same way.
6. The resulting `VerifiedBrief` (schema-valid AND grounding-verified) is the only thing the
   UI ever renders.

## Why grounding is enforced in code, not just requested in the prompt

A sufficiently well-crafted prompt can reduce hallucination, but it cannot eliminate it, and it
cannot prove after the fact that a given claim was real. Asking the model to also return the
literal source substring behind every claim makes the quote checkable with a cheap,
deterministic, testable substring match that doesn't depend on the model's honesty on any given
call. That covers the quote only. The plain-language `text` written next to it is still the
model's wording, and a real run has produced a claim ("security … improvements") that its quote
did not support. See `src/brief/grounding.test.ts` for the tests exercising the quote check with
a fabricated quote, and the evaluation-harness issue in `ISSUES_BACKLOG.md` for measuring the
rest.

## Why native structured outputs, not tool-use

Claude's API also supports forcing structured output via a fake "tool call" (`tool_choice`).
This project uses the newer, more direct `output_config.format` (JSON Schema) constraint
instead — see `src/brief/generate.ts`'s module comment and
[the structured-outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
Both approaches produce a schema-conformant response; grounding verification still applies
identically to either.

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
