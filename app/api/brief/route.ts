import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MAX_BRIEF_REQUEST_BYTES, MAX_SOURCE_TEXT_CHARS, readBodyWithinLimit } from '@/src/api/body-limit';
import { clientKey, getBriefLimiter, rateLimitMessage } from '@/src/api/rate-limit';
import { generateBrief } from '@/src/brief/generate';
import { resolveGenerator } from '@/src/brief/providers/resolve';

const RequestSchema = z.object({
  sourceText: z.string().min(1).max(MAX_SOURCE_TEXT_CHARS),
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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Brief generation failed: ${message}` }, { status: 502 });
  }
}
