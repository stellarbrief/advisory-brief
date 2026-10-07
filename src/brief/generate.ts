import { z } from 'zod';
import { verifyBrief } from './grounding';
import type { RawJsonGenerator } from './providers/types';
import { RawBriefSchema, type RawBrief, type VerifiedBrief } from './schema';

/** Generated once from `RawBriefSchema` itself (zod v4's native `z.toJSONSchema`), not
 * hand-duplicated -- the model's output contract and the schema this file validates it
 * against can never drift apart, because they're the same object. Shared across every
 * provider (`src/brief/providers/`), so an Anthropic call and a Gemini call are constrained
 * to the exact same shape. */
const RAW_BRIEF_JSON_SCHEMA = z.toJSONSchema(RawBriefSchema) as Record<string, unknown>;

export interface GenerateBriefInput {
  sourceText: string;
  sourceUrl: string | null;
  sourceLabel: string;
}

/**
 * Provider-agnostic: takes any `RawJsonGenerator` (Anthropic, Gemini, or a test double) and
 * handles the parts that don't vary by provider -- prompt construction, shape validation, and
 * grounding verification (`verifyBrief`). A schema-conformant response only guarantees SHAPE;
 * it does not mean every quote is real, which is the actual thing this product depends on and
 * `verifyBrief` is what actually checks.
 */
export async function generateBrief(generator: RawJsonGenerator, input: GenerateBriefInput): Promise<VerifiedBrief> {
  return (await generateBriefDetailed(generator, input)).verified;
}

export interface GenerateBriefResult {
  /** What the model returned, schema-valid but not yet checked against the source. */
  raw: RawBrief;
  verified: VerifiedBrief;
}

/** Same as `generateBrief`, but also returns the raw model output, so a recording can show
 * what the verifier was given and what it removed. */
export async function generateBriefDetailed(
  generator: RawJsonGenerator,
  input: GenerateBriefInput
): Promise<GenerateBriefResult> {
  const rawText = await generator.generate(buildPrompt(input.sourceText), RAW_BRIEF_JSON_SCHEMA);
  const parsedJson = JSON.parse(rawText);
  const raw = RawBriefSchema.parse(parsedJson);

  return { raw, verified: verifyBrief(raw, input.sourceText, input.sourceUrl, input.sourceLabel) };
}

function buildPrompt(sourceText: string): string {
  return `You are analyzing a Stellar network security advisory or release announcement for a non-engineer audience (business owners, compliance leads, product managers at wallets, anchors, fintechs, and exchanges).

CORE RULE, enforced by code after you respond, not just requested here: every factual claim you make must carry a \`quote\` field containing a VERBATIM substring (25 words or fewer) copied exactly from the source text below, OR you must set \`unknown: true\` and leave \`quote\` null. Any claim whose quote does not actually appear in the source will be automatically stripped before a user ever sees it, so inventing or paraphrasing a "quote" only makes your response worse, never better. If the advisory doesn't say something, say so with \`unknown: true\` rather than guessing.

Any date you cite in \`urgency.deadlines\` must also appear verbatim in the source text, or it will be silently dropped.

The same code reads the numbers, versions and dates inside your \`text\` fields: a figure the source does not state anywhere removes that whole claim. Copy figures exactly as the source writes them rather than converting or rounding them, and if you cannot state one exactly, write the claim without it or mark it \`unknown: true\`.

For \`affected\`, produce exactly one entry for each of these four audiences, in this order: wallet, anchor, fintech, exchange. Set \`affected\` to YES, NO, or UNCLEAR based only on what the source text supports.

Source text:
"""
${sourceText}
"""`;
}
