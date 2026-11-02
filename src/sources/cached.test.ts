import { describe, expect, it, vi } from 'vitest';
import { cachedSource } from './cached';
import type { Advisory, AdvisorySource } from './types';

const ADVISORY: Advisory = { sourceUrl: 'https://example.com/a', sourceLabel: 'a', text: 'text' };

function upstream(fetchLatest: () => Promise<Advisory[]>) {
  const calls = vi.fn(fetchLatest);
  const source: AdvisorySource = { id: 'test:source', name: 'Test source', fetchLatest: calls };
  return { source, calls };
}

describe('cachedSource (fake clock, no network)', () => {
  it('keeps the id and name of the source it wraps', () => {
    const { source } = upstream(async () => []);
    const cached = cachedSource(source, { ttlMs: 1000 });
    expect(cached.id).toBe('test:source');
    expect(cached.name).toBe('Test source');
  });

  it('asks the source once for any number of calls inside the window, and again after it', async () => {
    let clock = 1_000;
    const { source, calls } = upstream(async () => [ADVISORY]);
    const cached = cachedSource(source, { ttlMs: 60_000, now: () => clock });

    expect(await cached.fetchLatest()).toEqual([ADVISORY]);
    expect(await cached.fetchLatest()).toEqual([ADVISORY]);
    clock += 59_999;
    expect(await cached.fetchLatest()).toEqual([ADVISORY]);
    expect(calls).toHaveBeenCalledTimes(1);

    // The window is exactly ttlMs long: at that moment the answer is no longer reused.
    clock += 1;
    await cached.fetchLatest();
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('shares one request among callers that arrive while it is under way', async () => {
    let finish!: (advisories: Advisory[]) => void;
    const { source, calls } = upstream(
      () =>
        new Promise<Advisory[]>((resolve) => {
          finish = resolve;
        })
    );
    const cached = cachedSource(source, { ttlMs: 60_000 });

    const callers = [cached.fetchLatest(), cached.fetchLatest(), cached.fetchLatest()];
    expect(calls).toHaveBeenCalledTimes(1);

    finish([ADVISORY]);
    expect(await Promise.all(callers)).toEqual([[ADVISORY], [ADVISORY], [ADVISORY]]);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure, so the next caller asks the source again', async () => {
    const { source, calls } = upstream(async () => [ADVISORY]);
    calls.mockRejectedValueOnce(new Error('GitHub is down'));
    const cached = cachedSource(source, { ttlMs: 60_000 });

    await expect(cached.fetchLatest()).rejects.toThrow('GitHub is down');
    expect(await cached.fetchLatest()).toEqual([ADVISORY]);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('shows every caller that was waiting the same failure, from one request', async () => {
    const { source, calls } = upstream(async () => {
      throw new Error('GitHub is down');
    });
    const cached = cachedSource(source, { ttlMs: 60_000 });

    const results = await Promise.allSettled([cached.fetchLatest(), cached.fetchLatest()]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
