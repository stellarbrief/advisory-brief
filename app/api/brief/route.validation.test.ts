import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBrief } from '@/src/brief/generate';
import { POST } from './route';

// A configured provider and a stubbed brief, so a request that passes validation comes back 200
// without touching the network, and a request that fails it can be shown never to have asked for a
// brief at all.
vi.mock('@/src/brief/providers/resolve', () => ({ resolveGenerator: () => ({}) }));
vi.mock('@/src/brief/generate', () => ({ generateBrief: vi.fn(async () => ({ stub: true })) }));

const fields = { sourceUrl: null, sourceLabel: 'test' };

// Each request gets its own client address so the rate limiter never gets in the way.
let nextIp = 1;
function post(body: unknown): Request {
  return new Request('http://localhost/api/brief', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${nextIp++}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(generateBrief).mockClear();
});

describe('POST /api/brief sourceText', () => {
  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['only spaces, tabs and newlines', '  \n\t \r\n '],
  ])('answers 400 to a source text that is %s, and never asks for a brief', async (_name, sourceText) => {
    const res = await POST(post({ ...fields, sourceText }));
    expect(res.status).toBe(400);
    expect(generateBrief).not.toHaveBeenCalled();
  });

  it('tells the client what to do', async () => {
    const res = await POST(post({ ...fields, sourceText: '   ' }));
    expect((await res.json()).error).toContain('paste the advisory text first');
  });

  it('still accepts a text with real content inside whitespace, and passes it on exactly as sent', async () => {
    const sourceText = '\n  A real advisory.  \n';
    const res = await POST(post({ ...fields, sourceText }));
    expect(res.status).toBe(200);
    expect(generateBrief).toHaveBeenCalledTimes(1);
    expect(generateBrief).toHaveBeenCalledWith({}, expect.objectContaining({ sourceText }));
  });
});

const advisory = { sourceText: 'Some advisory text.' };

describe('POST /api/brief sourceUrl', () => {
  it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://example.com/x'])(
    'answers 400 to %s, and never asks for a brief',
    async (sourceUrl) => {
      const res = await POST(post({ ...advisory, sourceUrl, sourceLabel: 'test' }));
      expect(res.status).toBe(400);
      expect(generateBrief).not.toHaveBeenCalled();
    }
  );

  it('tells the client what is accepted', async () => {
    const res = await POST(post({ ...advisory, sourceUrl: 'javascript:alert(1)', sourceLabel: 'test' }));
    expect((await res.json()).error).toContain('use an http or https address');
  });

  it.each([
    'https://github.com/stellar/stellar-core/releases/tag/v29.0.0',
    'http://example.com/x',
    null,
  ])('accepts %s and passes it on unchanged', async (sourceUrl) => {
    const res = await POST(post({ ...advisory, sourceUrl, sourceLabel: 'test' }));
    expect(res.status).toBe(200);
    expect(generateBrief).toHaveBeenCalledWith({}, expect.objectContaining({ sourceUrl }));
  });

  it('refuses something that is not an address at all', async () => {
    const res = await POST(post({ ...advisory, sourceUrl: 'not a url', sourceLabel: 'test' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/brief sourceLabel', () => {
  it('accepts a label of exactly 200 characters', async () => {
    const sourceLabel = 'a'.repeat(200);
    const res = await POST(post({ ...advisory, sourceUrl: null, sourceLabel }));
    expect(res.status).toBe(200);
    expect(generateBrief).toHaveBeenCalledWith({}, expect.objectContaining({ sourceLabel }));
  });

  it('answers 400 to a label of 201 characters, and says what the limit is', async () => {
    const res = await POST(post({ ...advisory, sourceUrl: null, sourceLabel: 'a'.repeat(201) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('200 characters or fewer');
    expect(generateBrief).not.toHaveBeenCalled();
  });

  it('still refuses an empty label', async () => {
    const res = await POST(post({ ...advisory, sourceUrl: null, sourceLabel: '' }));
    expect(res.status).toBe(400);
  });
});
