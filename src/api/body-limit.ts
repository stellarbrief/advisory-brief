/** How much of a request body `/api/brief` is willing to hold in memory.
 *
 * The real limit is on `sourceText`, checked by the route's schema after parsing. This byte cap
 * exists so that check can't be reached by sending an arbitrarily large body first: the route
 * refuses anything bigger before parsing it, whether the client says so up front in
 * `Content-Length` or the body (chunked, or with a wrong header) only turns out that big while
 * it is being read.
 */

/** The `sourceText` cap, in characters (UTF-16 code units, which is what zod's `.max` counts). */
export const MAX_SOURCE_TEXT_CHARS = 20_000;

/** The body size the route accepts, derived from the character cap so the two can't drift.
 *
 * In JSON, one UTF-16 code unit takes at most six bytes (a `\uXXXX` escape; as raw UTF-8 it is
 * at most three), so a `sourceText` at the cap always fits, however the client encodes it. The
 * extra 16 KiB covers the other fields and the JSON around them.
 */
export const MAX_BRIEF_REQUEST_BYTES = MAX_SOURCE_TEXT_CHARS * 6 + 16 * 1024;

/** Reads `request`'s body as UTF-8 text without holding more than `maxBytes` of it.
 *
 * Returns `null` when the body is over the limit, either because `Content-Length` declares more
 * (in which case nothing is read) or because the bytes received pass the limit (in which case
 * reading stops there and the rest of the stream is cancelled).
 */
export async function readBodyWithinLimit(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
