import type { Advisory, AdvisorySource } from './types';

/** Real field names confirmed directly against GitHub's own Releases API
 * (`GET /repos/{owner}/{repo}/releases`), not assumed. */
interface GitHubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}

/** How long to wait for GitHub before giving up on the request, headers and body together.
 * Without a limit, a GitHub that accepts the connection and never answers would hold the
 * request that asked for it open for as long as the platform allows. */
export const GITHUB_FETCH_TIMEOUT_MS = 10_000;

export interface GitHubReleasesOptions {
  /** Overrides `GITHUB_FETCH_TIMEOUT_MS`; a test uses this to avoid waiting ten seconds. */
  timeoutMs?: number;
}

export function createGitHubReleasesSource(
  owner: string,
  repo: string,
  options: GitHubReleasesOptions = {}
): AdvisorySource {
  const timeoutMs = options.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS;
  return {
    id: `github-releases:${owner}/${repo}`,
    name: `${owner}/${repo} GitHub Releases`,
    async fetchLatest(): Promise<Advisory[]> {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      // Optional: unauthenticated GitHub API requests are capped at 60/hour per IP, which a
      // deployed app can hit under real traffic. A GITHUB_TOKEN env var (a plain public-repo
      // read token, nothing more) raises that limit; the source still works without one.
      if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      let res: Response;
      try {
        res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // A timeout surfaces as a bare "The operation was aborted due to timeout"; say whose
        // request it was and how long it was given.
        if (err instanceof Error && err.name === 'TimeoutError') {
          throw new Error(`GitHub Releases fetch timed out after ${timeoutMs} ms for ${owner}/${repo}`);
        }
        throw err;
      }
      if (!res.ok) {
        throw new Error(`GitHub Releases fetch failed for ${owner}/${repo}: ${res.status} ${res.statusText}`);
      }
      const releases = (await res.json()) as GitHubRelease[];

      return releases
        .filter((r) => !r.draft && !r.prerelease && r.body)
        .map((r) => ({
          sourceUrl: r.html_url,
          sourceLabel: `${owner}/${repo} release ${r.tag_name}`,
          text: r.body as string,
          publishedAt: r.published_at ?? undefined,
        }));
    },
  };
}

export const stellarCoreReleasesSource = createGitHubReleasesSource('stellar', 'stellar-core');
