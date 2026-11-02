import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSY_MESSAGE, GENERIC_MESSAGE, REFUSED_MESSAGE } from '@/src/api/generation-error';
import { generateBrief } from '@/src/brief/generate';
import { POST } from './route';

// A configured provider whose brief generation fails however each test says, so the route's
// failure path runs without touching the network.
vi.mock('@/src/brief/providers/resolve', () => ({ resolveGenerator: () => ({}) }));
vi.mock('@/src/brief/generate', () => ({ generateBrief: vi.fn() }));

const PRIVATE = 'request_id=req_0123456789 key sk-ant-api03-PRIVATE';

// Each request gets its own client address so the rate limiter never gets in the way.
let nextIp = 1;
function post(): Request {
  return new Request('http://localhost/api/brief', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${nextIp++}` },
    body: JSON.stringify({ sourceText: 'Some advisory text.', sourceUrl: null, sourceLabel: 'test' }),
  });
}

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(generateBrief).mockReset();
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logged.mockRestore();
});

describe('POST /api/brief when generating the brief fails', () => {
  it('answers 502 with a fixed sentence for the kind of failure, not the provider text', async () => {
    const refused = Object.assign(new Error(`401 {"error":"${PRIVATE}"}`), { status: 401 });
    vi.mocked(generateBrief).mockRejectedValue(refused);

    const res = await POST(post());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe(REFUSED_MESSAGE);
    expect(text).not.toContain('PRIVATE');
    expect(text).not.toContain('req_0123456789');
  });

  it('tells a visitor the provider is busy when it answered 429', async () => {
    vi.mocked(generateBrief).mockRejectedValue(Object.assign(new Error(PRIVATE), { status: 429 }));
    const res = await POST(post());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(BUSY_MESSAGE);
  });

  it('uses the generic sentence for an error it cannot classify, and still never repeats it', async () => {
    vi.mocked(generateBrief).mockRejectedValue(new Error(PRIVATE));
    const res = await POST(post());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe(GENERIC_MESSAGE);
    expect(text).not.toContain('PRIVATE');
  });

  it('writes the real error to the server log, so whoever runs the server can see what happened', async () => {
    const failure = new Error(PRIVATE);
    vi.mocked(generateBrief).mockRejectedValue(failure);
    await POST(post());
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('api/brief'), failure);
  });
});
