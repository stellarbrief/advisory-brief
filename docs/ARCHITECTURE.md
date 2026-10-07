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

## Extension points

- **Sources** (`src/sources/`): implement `AdvisorySource` (`id`, `name`, `fetchLatest()`).
  See [`ADDING_A_SOURCE.md`](ADDING_A_SOURCE.md).
- **Audiences** (`src/audiences/`): add a JSON profile. See
  [`ADDING_AN_AUDIENCE.md`](ADDING_AN_AUDIENCE.md).

Neither extension point requires touching `src/brief/` (the grounding/generation core) at all.
