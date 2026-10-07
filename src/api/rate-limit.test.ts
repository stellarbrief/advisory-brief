import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  briefRateLimitFromEnv,
  clientKey,
  createRateLimiter,
  describeWindow,
  rateLimitMessage,
} from './rate-limit';

const WINDOW_MS = 60_000;

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows exactly the limit and rejects the request after it', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: WINDOW_MS });
    expect([1, 2, 3].map(() => limiter.check('a').allowed)).toEqual([true, true, true]);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('resets when the window closes', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: WINDOW_MS });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);

    vi.advanceTimersByTime(WINDOW_MS - 1);
    expect(limiter.check('a').allowed).toBe(false);

    vi.advanceTimersByTime(1);
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('counts each client address in its own window', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: WINDOW_MS });
    expect(limiter.check('203.0.113.1').allowed).toBe(true);
    expect(limiter.check('203.0.113.2').allowed).toBe(true);
    expect(limiter.check('203.0.113.1').allowed).toBe(false);
  });

  it('says how long to wait, and counts down as the window closes', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: WINDOW_MS });
    expect(limiter.check('a').retryAfterSeconds).toBe(0);
    vi.advanceTimersByTime(40_000);
    expect(limiter.check('a').retryAfterSeconds).toBe(20);
    expect(limiter.check('a').remaining).toBe(0);
    expect(limiter.check('a').limit).toBe(1);
  });

  it('reports the configured window length, not a hardcoded minute', () => {
    expect(createRateLimiter({ limit: 1, windowMs: 45_000 }).check('a').windowSeconds).toBe(45);
    expect(createRateLimiter({ limit: 1, windowMs: WINDOW_MS }).check('a').windowSeconds).toBe(60);
  });

  it('starts a new window for a key whose window already closed', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    limiter.check('a');
    vi.advanceTimersByTime(1_500);
    expect(limiter.check('a')).toMatchObject({ allowed: true, remaining: 1 });
  });
});

describe('briefRateLimitFromEnv', () => {
  it('uses documented defaults when the environment says nothing', () => {
    expect(briefRateLimitFromEnv({})).toEqual({ limit: 10, windowMs: 60_000 });
  });

  it('takes the limit and window from the environment', () => {
    expect(briefRateLimitFromEnv({ BRIEF_RATE_LIMIT_REQUESTS: '5', BRIEF_RATE_LIMIT_WINDOW_SECONDS: '30' })).toEqual({
      limit: 5,
      windowMs: 30_000,
    });
  });

  it('ignores a nonsensical value rather than limiting to zero or NaN', () => {
    for (const raw of ['0', '-4', 'abc', '']) {
      expect(briefRateLimitFromEnv({ BRIEF_RATE_LIMIT_REQUESTS: raw }).limit).toBe(10);
    }
  });
});

describe('clientKey', () => {
  function requestWith(headers: Record<string, string>): Request {
    return new Request('http://localhost/api/brief', { method: 'POST', headers });
  }

  it('uses the client address a proxy put first in X-Forwarded-For', () => {
    expect(clientKey(requestWith({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to X-Real-IP, then to one shared bucket', () => {
    expect(clientKey(requestWith({ 'x-real-ip': '203.0.113.8' }))).toBe('203.0.113.8');
    expect(clientKey(requestWith({}))).toBe('shared');
  });

  it('does not treat a blank forwarded header as an address', () => {
    expect(clientKey(requestWith({ 'x-forwarded-for': ' , ' }))).toBe('shared');
  });
});

describe('the 429 message', () => {
  it('names the window in words, including when it is not a minute', () => {
    expect(describeWindow(60)).toBe('minute');
    expect(describeWindow(45)).toBe('45 seconds');
    expect(describeWindow(1)).toBe('second');
    expect(describeWindow(300)).toBe('5 minutes');
    expect(describeWindow(3600)).toBe('hour');
  });

  it('says per-minute only for a minute-long window', () => {
    const base = { allowed: false, limit: 10, remaining: 0, retryAfterSeconds: 37 };
    expect(rateLimitMessage({ ...base, windowSeconds: 60 })).toBe(
      'Rate limit reached: 10 brief requests per minute per address. Try again in 37 seconds.'
    );
    expect(rateLimitMessage({ ...base, windowSeconds: 45 })).toBe(
      'Rate limit reached: 10 brief requests per 45 seconds per address. Try again in 37 seconds.'
    );
    expect(rateLimitMessage({ ...base, windowSeconds: 900 })).toBe(
      'Rate limit reached: 10 brief requests per 15 minutes per address. Try again in 37 seconds.'
    );
  });
});
