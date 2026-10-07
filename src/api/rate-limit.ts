/** Fixed-window rate limiting for the endpoints that spend something.
 *
 * State lives in this Node process's memory. That is the right trade for a self-hosted,
 * single-instance tool (no Redis, no cloud vendor, works offline), and it is exactly why
 * `docs/ARCHITECTURE.md` records what it does NOT do: the count does not survive a restart and
 * is not shared between instances or serverless isolates. See the README's Deployment note.
 */

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  /** Requests this key may still make in the current window. */
  remaining: number;
  /** Whole seconds until the current window closes; 0 when the request is allowed. */
  retryAfterSeconds: number;
  /** The configured window length, so a message can name the window instead of assuming a minute. */
  windowSeconds: number;
}

export interface RateLimiter {
  /** Consume one request for `key`. `at` is injectable so tests can move the clock. */
  check(key: string, at?: number): RateLimitDecision;
}

export interface RateLimitOptions {
  /** Requests allowed per key per window. */
  limit: number;
  windowMs: number;
  /** Overrides the clock; defaults to `Date.now` read at check time. */
  now?: () => number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { limit, windowMs } = options;
  // Read the clock lazily rather than capturing `Date.now` here, so a test (or a later module)
  // that replaces the global clock is actually obeyed by a limiter built before that happened.
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = 0;

  // Keys are cheap to invent, so expired windows have to be dropped or the map grows with
  // traffic instead of with concurrent clients. Sweeping once per window keeps that cost bounded.
  function sweep(at: number): void {
    if (at - lastSweep < windowMs) return;
    lastSweep = at;
    for (const [key, window] of windows) {
      if (at - window.start >= windowMs) windows.delete(key);
    }
  }

  return {
    check(key, at = now()) {
      sweep(at);
      const current = windows.get(key);
      const window = current && at - current.start < windowMs ? current : { start: at, count: 0 };
      window.count++;
      windows.set(key, window);
      return {
        allowed: window.count <= limit,
        limit,
        remaining: Math.max(0, limit - window.count),
        retryAfterSeconds: window.count <= limit ? 0 : Math.ceil((windowMs - (at - window.start)) / 1000),
        windowSeconds: windowMs / 1000,
      };
    },
  };
}

/** The defaults: enough for a person reading a few advisories a minute, low enough that an
 * accidental loop cannot drain a model quota. */
export const DEFAULT_LIMIT_REQUESTS = 10;
export const DEFAULT_WINDOW_SECONDS = 60;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

export function briefRateLimitFromEnv(env: Record<string, string | undefined> = process.env): RateLimitOptions {
  return {
    limit: positiveInt(env.BRIEF_RATE_LIMIT_REQUESTS, DEFAULT_LIMIT_REQUESTS),
    windowMs: positiveInt(env.BRIEF_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS) * 1000,
  };
}

/** Identify the client by address, falling back to one shared bucket when no proxy told us one.
 *
 * `X-Forwarded-for` is client-supplied: anyone who can reach the route directly can set it, and
 * a proxy that does not overwrite it lets a client pick a fresh bucket per request. The limiter
 * therefore has to sit behind a proxy that sets the header itself (`trust proxy` in Express terms,
 * the default on Vercel/Railway/Nginx-with-proxy_set_header). Without that, this is a loop
 * breaker, not an abuse barrier.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  return request.headers.get('x-real-ip') ?? 'shared';
}

let briefLimiter: RateLimiter | null = null;

/** The limiter `/api/brief` shares, built from the environment on first use. */
export function getBriefLimiter(): RateLimiter {
  briefLimiter ??= createRateLimiter(briefRateLimitFromEnv());
  return briefLimiter;
}

/** A window in words, for a message a person reads while being blocked: "minute" for 60s,
 * "5 minutes" for 300s, "45 seconds" for 45s. Naming the configured window rather than assuming
 * one minute is the difference between a message someone can act on and one they have to guess at. */
export function describeWindow(seconds: number): string {
  if (seconds === 1) return 'second';
  if (seconds === 60) return 'minute';
  if (seconds === 3600) return 'hour';
  if (seconds === 86400) return 'day';
  return seconds % 60 === 0 ? `${seconds / 60} minutes` : `${seconds} seconds`;
}

export function rateLimitMessage(decision: RateLimitDecision): string {
  return (
    `Rate limit reached: ${decision.limit} brief requests per ${describeWindow(decision.windowSeconds)} ` +
    `per address. Try again in ${decision.retryAfterSeconds} seconds.`
  );
}
