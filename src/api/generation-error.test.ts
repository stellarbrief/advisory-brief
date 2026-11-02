import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BAD_ANSWER_MESSAGE,
  BUSY_MESSAGE,
  GENERIC_MESSAGE,
  REFUSED_MESSAGE,
  describeGenerationFailure,
} from './generation-error';

// Text of the kind a provider's error carries and a visitor must never be shown.
const PRIVATE = 'request_id=req_0123456789 key sk-ant-api03-PRIVATE';

function providerError(status: number): Error {
  return Object.assign(new Error(`${status} {"error":"${PRIVATE}"}`), { status });
}

function jsonSyntaxError(): unknown {
  try {
    JSON.parse(`not json ${PRIVATE}`);
  } catch (err) {
    return err;
  }
  throw new Error('JSON.parse accepted text that is not JSON');
}

function zodError(): unknown {
  const result = z.object({ summary: z.string() }).safeParse({ summary: PRIVATE.length });
  if (result.success) throw new Error('the schema accepted a wrong shape');
  return result.error;
}

describe('describeGenerationFailure', () => {
  it.each([429, 503, 529])('says the provider is busy when it answered %i', (status) => {
    expect(describeGenerationFailure(providerError(status))).toBe(BUSY_MESSAGE);
  });

  it.each([401, 403])('says the key was refused when the provider answered %i', (status) => {
    expect(describeGenerationFailure(providerError(status))).toBe(REFUSED_MESSAGE);
  });

  it('says the answer was malformed when the model returned text that is not JSON', () => {
    expect(describeGenerationFailure(jsonSyntaxError())).toBe(BAD_ANSWER_MESSAGE);
  });

  it('says the answer was malformed when the model returned JSON of the wrong shape', () => {
    expect(describeGenerationFailure(zodError())).toBe(BAD_ANSWER_MESSAGE);
  });

  it.each([
    ['another provider status', providerError(500)],
    ['a status that is not a number', Object.assign(new Error('x'), { status: '429' })],
    ['an error with no status', new Error('connection reset')],
    ['something that is not an Error', 'a string was thrown'],
    ['nothing at all', undefined],
  ])('falls back to the generic sentence for %s', (_name, err) => {
    expect(describeGenerationFailure(err)).toBe(GENERIC_MESSAGE);
  });

  it('never repeats any of the error text, whatever kind of failure it was', () => {
    const failures = [
      providerError(429),
      providerError(401),
      providerError(500),
      jsonSyntaxError(),
      zodError(),
      new Error(PRIVATE),
      PRIVATE,
    ];
    for (const failure of failures) {
      const message = describeGenerationFailure(failure);
      expect(message).not.toContain('req_0123456789');
      expect(message).not.toContain('sk-ant');
      expect(message).not.toContain('PRIVATE');
    }
  });
});
