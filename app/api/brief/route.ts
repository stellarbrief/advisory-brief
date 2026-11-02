import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MAX_BRIEF_REQUEST_BYTES, MAX_SOURCE_TEXT_CHARS, readBodyWithinLimit } from '@/src/api/body-limit';
import { describeGenerationFailure } from '@/src/api/generation-error';
import { clientKey, getBriefLimiter, rateLimitMessage } from '@/src/api/rate-limit';
import { generateBrief } from '@/src/brief/generate';
import { resolveGenerator } from '@/src/brief/providers/resolve';

/** What a client is told when the source text has nothing in it. */
const SOURCE_TEXT_REQUIRED_MESSAGE ='sourceText: paste the advisory text first.';

const RequestSchema = z.object({
  // Text that is empty after trimming would pass `min(1)` as "   " and then be sent to the model
  // provider, spending the key's quota on a brief about nothing. The page already disables the
  // button for it; this is the same guard for everyone who calls the API directly. The text is
  // kept exactly as sent: grounding normalizes whitespace in the source and in each quote before
  // it compares them, so trimming here would change nothing it relies on.
  sourceText: z
    .string()
    .max(MAX_SOURCE_TEXT_CHARS)
    .refine((text) => text.trim().length > 0, { message: SOURCE_TEXT_REQUIRED_MESSAGE }),
  sourceUrl: z.string().url().nullable(),
  sourceLabel: z.string().min(1),
});

// Not cached and not statically prerenderable -- a real, per-request model call, matching
// Next.js 16's Route Handler behavior for a POST (POST responses are never cached, unlike
// GET, per node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md).
export async function POST(request: Request) {
  // Before anything that reads the body or spends the API key: every request that reaches this
  // function has already cost the process something, so the window is consumed even when the
  // request then fails for another reason.
  const decision = getBriefLimiter().check(clientKey(request));
  if (!decision.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(decision) },
      {
        status: 429,
        headers: {
          'Retry-After': String(decision.retryAfterSeconds),
          'X-RateLimit-Limit': String(decision.limit),
          'X-RateLimit-Remaining': String(decision.remaining),
        },
      }
    );
  }

  const generator = resolveGenerator();
  if (!generator) {
    return NextResponse.json(
      { error: 'Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is configured on this server.' },
      { status: 500 }
    );
  }

  const text = await readBodyWithinLimit(request, MAX_BRIEF_REQUEST_BYTES);
  if (text === null) {
    return NextResponse.json(
      { error: `Request body is larger than ${MAX_BRIEF_REQUEST_BYTES} bytes.` },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const brief = await generateBrief(generator, parsed.data);
    return NextResponse.json({ brief });
  } catch (err) {
    // The real error goes to the server log, where whoever runs this server can read it. The
    // visitor gets a fixed sentence for the kind of failure, never the provider's own text.
    console.error('[api/brief] brief generation failed:', err);
    return NextResponse.json({ error: describeGenerationFailure(err) }, { status: 502 });
  }
}
