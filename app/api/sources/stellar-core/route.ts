import { NextResponse } from 'next/server';
import { cachedSource } from '../../../../src/sources/cached';
import { stellarCoreReleasesSource } from '../../../../src/sources/github-releases';

/** How long the latest releases are reused. stellar-core publishes a release every few weeks, so
 * five minutes loses nothing, and it caps this route at twelve requests an hour to GitHub per
 * process, however many people call it. */
const RELEASES_CACHE_TTL_MS = 5 * 60 * 1000;

const source = cachedSource(stellarCoreReleasesSource, { ttlMs: RELEASES_CACHE_TTL_MS });

export async function GET() {
  try {
    const advisories = await source.fetchLatest();
    return NextResponse.json({ advisories });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
