import { describe, expect, it } from 'vitest';
import { readBodyWithinLimit } from './body-limit';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/', { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
}

describe('readBodyWithinLimit', () => {
  it('returns the body when it is exactly the limit', async () => {
    expect(await readBodyWithinLimit(request('12345'), 5)).toBe('12345');
  });

  it('returns null one byte over the limit', async () => {
    expect(await readBodyWithinLimit(request('123456'), 5)).toBeNull();
  });

  it('counts bytes, not characters', async () => {
    // Two characters, six bytes in UTF-8.
    expect(await readBodyWithinLimit(request('€€'), 5)).toBeNull();
    expect(await readBodyWithinLimit(request('€€'), 6)).toBe('€€');
  });

  it('joins a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('€');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1));
        controller.close();
      },
    });
    expect(await readBodyWithinLimit(request(stream), 3)).toBe('€');
  });

  it('does not trust a Content-Length that understates the body', async () => {
    expect(await readBodyWithinLimit(request(streamOf('123', '456'), { 'content-length': '3' }), 5)).toBeNull();
  });

  it('returns an empty string for a request with no body', async () => {
    expect(await readBodyWithinLimit(request(null), 5)).toBe('');
  });
});
