import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BRIEF_REQUEST_BYTES, MAX_SOURCE_TEXT_CHARS } from '@/src/api/body-limit';
import { generateBrief } from '@/src/brief/generate';
import { POST } from './route';

// A configured provider and a stubbed brief, so a request that passes the size and schema checks
// comes back 200 without touching the network.
vi.mock('@/src/brief/providers/resolve', () => ({ resolveGenerator: () => ({}) }));
vi.mock('@/src/brief/generate', () => ({ generateBrief: vi.fn(async () => ({ stub: true })) }));

const fields = { sourceUrl: null, sourceLabel: 'test' };

// Each request gets its own client address so the rate limiter never gets in the way.
let nextIp = 1;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${nextIp++}`, ...extra };
}

function post(body: string): Request {
  return new Request('http://localhost/api/brief', { method: 'POST', headers: headers(), body });
}

beforeEach(() => {
  vi.mocked(generateBrief).mockClear();
});

describe('POST /api/brief body size limit', () => {
  it('answers 413 to a declared Content-Length over the limit without reading the body', async () => {
    const request = new Request('http://localhost/api/brief', {
      method: 'POST',
      headers: headers({ 'content-length': String(MAX_BRIEF_REQUEST_BYTES + 1) }),
      body: new ReadableStream({ start: (controller) => controller.close() }),
      duplex: 'half',
    } as RequestInit);

    const res = await POST(request);
    expect(res.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expect(generateBrief).not.toHaveBeenCalled();
  });

  it('answers 413 to a chunked body once it grows past the limit, and stops reading it', async () => {
    const chunk = new Uint8Array(16 * 1024).fill(0x20);
    let sent = 0;
    let cancelled = false;
    const request = new Request('http://localhost/api/brief', {
      method: 'POST',
      headers: headers(),
      // No Content-Length and no end: only the byte count can stop this one.
      body: new ReadableStream({
        pull(controller) {
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();

    const res = await POST(request);
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(MAX_BRIEF_REQUEST_BYTES + 3 * chunk.byteLength);
    expect(generateBrief).not.toHaveBeenCalled();
  });

  it('accepts sourceText at the character cap made of three-byte UTF-8 characters', async () => {
    const sourceText = '€'.repeat(MAX_SOURCE_TEXT_CHARS);
    const body = JSON.stringify({ sourceText, ...fields });
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(3 * MAX_SOURCE_TEXT_CHARS);

    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(vi.mocked(generateBrief).mock.calls[0][1].sourceText).toBe(sourceText);
  });

  it('accepts the same text sent as \\u escapes, the largest way to encode it', async () => {
    const body = `{"sourceText":"${'\\u20ac'.repeat(MAX_SOURCE_TEXT_CHARS)}","sourceUrl":null,"sourceLabel":"test"}`;
    expect(body.length).toBeGreaterThan(6 * MAX_SOURCE_TEXT_CHARS);

    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(vi.mocked(generateBrief).mock.calls[0][1].sourceText).toBe('€'.repeat(MAX_SOURCE_TEXT_CHARS));
  });

  it('leaves one character over the cap to the schema, which answers 400', async () => {
    const body = JSON.stringify({ sourceText: '€'.repeat(MAX_SOURCE_TEXT_CHARS + 1), ...fields });

    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(generateBrief).not.toHaveBeenCalled();
  });
});
