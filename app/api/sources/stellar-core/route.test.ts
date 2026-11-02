import { afterEach, describe, expect, it, vi } from 'vitest';

const RELEASE = {
  tag_name: 'v28.0.1',
  name: 'v28.0.1',
  html_url: 'https://github.com/stellar/stellar-core/releases/tag/v28.0.1',
  published_at: '2026-09-01T07:01:54Z',
  body: '## Stability Improvements\n\n- Deduplicate query messages',
  draft: false,
  prerelease: false,
};

/** The route keeps GitHub's answer in module state for five minutes, so each test loads its own
 * copy of the route and starts with nothing remembered. */
async function loadGET() {
  vi.resetModules();
  return (await import('./route')).GET;
}

describe('GET /api/sources/stellar-core (mocked fetch, no network)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the latest stable releases as advisories', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [RELEASE] }));
    const GET = await loadGET();
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.advisories).toHaveLength(1);
    expect(data.advisories[0].sourceLabel).toContain('v28.0.1');
  });

  it('returns a 502 with the reason when GitHub fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'rate limit exceeded' })
    );
    const GET = await loadGET();
    const res = await GET();
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain('403');
  });

  it('asks GitHub once however many times it is called inside five minutes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [RELEASE] });
    vi.stubGlobal('fetch', fetchMock);
    const GET = await loadGET();

    for (let i = 0; i < 25; i++) expect((await GET()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks GitHub again once the five minutes are over', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [RELEASE] });
    vi.stubGlobal('fetch', fetchMock);
    const GET = await loadGET();

    await GET();
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    await GET();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await GET();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure: the next call asks GitHub again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'rate limit exceeded' })
      .mockResolvedValueOnce({ ok: true, json: async () => [RELEASE] });
    vi.stubGlobal('fetch', fetchMock);
    const GET = await loadGET();

    expect((await GET()).status).toBe(502);
    expect((await GET()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
