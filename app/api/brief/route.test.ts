import { beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

// The limiter is module state built from the environment on the first request, so the stubs have
// to be in place before any test runs. Each test then uses its own client address, which is its
// own window.
const LIMIT = 2;

beforeAll(() => {
  vi.stubEnv('BRIEF_RATE_LIMIT_REQUESTS', String(LIMIT));
  // No provider key: a request that gets past the limiter stops at the key check with a 500 and
  // never reaches the network. Which of 500/429 comes back is what these tests assert.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('GEMINI_API_KEY', '');
});

function post(ip: string, body: unknown): Request {
  return new Request('http://localhost/api/brief', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/brief rate limit (fake clock, no network)', () => {
  it('answers an over-limit request with 429, a readable message and a Retry-After', async () => {
    const ip = '203.0.113.11';
    expect((await POST(post(ip, {}))).status).toBe(500);
    expect((await POST(post(ip, {}))).status).toBe(500);

    const res = await POST(post(ip, {}));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(new RegExp(`Rate limit reached: ${LIMIT} brief requests per minute per address`));
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('lets a different address through while the first one is blocked', async () => {
    const first = '203.0.113.12';
    const second = '203.0.113.13';
    await POST(post(first, {}));
    await POST(post(first, {}));
    expect((await POST(post(first, {}))).status).toBe(429);
    expect((await POST(post(second, {}))).status).toBe(500);
  });

  it('accepts requests again once the window has passed', async () => {
    vi.useFakeTimers();
    try {
      const ip = '203.0.113.14';
      await POST(post(ip, {}));
      await POST(post(ip, {}));
      expect((await POST(post(ip, {}))).status).toBe(429);

      vi.advanceTimersByTime(60_001);
      expect((await POST(post(ip, {}))).status).toBe(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts a request it then rejects for another reason, so a flood cannot bypass the window', async () => {
    const ip = '203.0.113.15';
    // A body the route would reject either way: the limiter has already spent the slot by then.
    await POST(post(ip, { sourceText: '' }));
    await POST(post(ip, { sourceText: '' }));
    expect((await POST(post(ip, { sourceText: '' }))).status).toBe(429);
  });

  it('gives clients with no forwarded address one shared window rather than unlimited requests', async () => {
    const bare = () =>
      new Request('http://localhost/api/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect((await POST(bare())).status).toBe(500);
    expect((await POST(bare())).status).toBe(500);
    expect((await POST(bare())).status).toBe(429);
  });
});
