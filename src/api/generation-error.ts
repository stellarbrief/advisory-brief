import { ZodError } from 'zod';

/** What `/api/brief` tells a visitor when producing a brief failed.
 *
 * The error that actually happened comes from somewhere the visitor has no business reading: a
 * provider's SDK (whose messages carry request ids, account or quota details, and sometimes the
 * body the provider sent back), or the parsing of the model's own output (whose messages quote
 * what the model wrote). `/api/brief` logs that error for whoever runs the server and sends the
 * visitor one of the fixed sentences below, chosen by what kind of failure it was.
 *
 * Provider SDKs put the HTTP status on the error as a number (`status`), which is all this reads
 * from them; it never looks at their message text.
 */

/** The provider answered "too many requests" or "overloaded" (429, 503, and Anthropic's 529). */
const BUSY_STATUSES = new Set([429, 503, 529]);
/** The provider refused the server's API key (401, 403). */
const REFUSED_STATUSES = new Set([401, 403]);

export const BUSY_MESSAGE = 'The model provider is busy or limiting this server. Try again in a minute.';
export const REFUSED_MESSAGE =
  "The model provider refused the server's API key. Whoever runs this server needs to check it.";
export const BAD_ANSWER_MESSAGE = "The model's answer was not in the expected format. Try again.";
export const GENERIC_MESSAGE = 'Brief generation failed. Try again; if it keeps happening, check the server log.';

function statusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null;
  const { status } = err as { status: unknown };
  return typeof status === 'number' ? status : null;
}

export function describeGenerationFailure(err: unknown): string {
  const status = statusOf(err);
  if (status !== null && BUSY_STATUSES.has(status)) return BUSY_MESSAGE;
  if (status !== null && REFUSED_STATUSES.has(status)) return REFUSED_MESSAGE;
  // `JSON.parse` of text that is not JSON, or `RawBriefSchema.parse` of JSON with the wrong shape.
  if (err instanceof SyntaxError || err instanceof ZodError) return BAD_ANSWER_MESSAGE;
  return GENERIC_MESSAGE;
}
