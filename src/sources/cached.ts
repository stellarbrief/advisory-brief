import type { Advisory, AdvisorySource } from './types';

export interface CacheOptions {
  /** How long a successful answer is reused, in milliseconds. */
  ttlMs: number;
  /** Overrides the clock; defaults to `Date.now` read at call time. */
  now?: () => number;
}

/** Wraps a source so that however many callers ask, the source behind it is asked at most once
 * per `ttlMs`.
 *
 * This is what stands between a busy page and GitHub's unauthenticated limit of 60 requests an
 * hour, which GitHub applies to the server's address and not to each visitor: without it, one
 * client reloading in a loop would use up the allowance for everyone for the rest of the hour.
 *
 * - A successful answer is kept for `ttlMs`.
 * - Callers that arrive while a request is already under way wait for that one request instead
 *   of starting their own, so a burst on an empty cache still costs one request.
 * - A failure is not kept. The next caller asks again, so a short outage does not turn into a
 *   `ttlMs`-long one.
 *
 * The cache lives in this process's memory, like the rate limiter in `src/api/rate-limit.ts`: a
 * restart clears it and each instance or serverless isolate keeps its own.
 */
export function cachedSource(source: AdvisorySource, options: CacheOptions): AdvisorySource {
  const now = options.now ?? (() => Date.now());
  let stored: { at: number; advisories: Advisory[] } | null = null;
  let underway: Promise<Advisory[]> | null = null;

  return {
    id: source.id,
    name: source.name,
    fetchLatest(): Promise<Advisory[]> {
      if (stored && now() - stored.at < options.ttlMs) return Promise.resolve(stored.advisories);
      underway ??= source
        .fetchLatest()
        .then((advisories) => {
          stored = { at: now(), advisories };
          return advisories;
        })
        .finally(() => {
          underway = null;
        });
      return underway;
    },
  };
}
