import { normalizeRepo, type NormalizedRepo, type RawGitHubRepo } from './normalize.ts';

export interface FetchOptions {
  token?: string;
  username?: string;
  perPage?: number;
  maxPages?: number; // Optional safety cap, defaults to Infinity
  onPageFetched?: (page: number, count: number) => void;
}

export class GitHubApiError extends Error {
  status: number;
  statusText: string;
  rateLimitReset?: Date;

  constructor(message: string, status: number, statusText: string, rateLimitReset?: Date) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.statusText = statusText;
    this.rateLimitReset = rateLimitReset;
  }
}

/**
 * Parses a target GitHub username from CLI arguments (--username <user>, --username=<user>, -u <user>)
 * or falls back to the GITHUB_USERNAME environment variable.
 */
export function parseUsernameFromArgs(argv: string[] = process.argv.slice(2)): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--username' && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      return argv[i + 1];
    }
    if (arg.startsWith('--username=')) {
      return arg.slice('--username='.length);
    }
    if (arg === '-u' && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      return argv[i + 1];
    }
  }
  return process.env.GITHUB_USERNAME?.trim() || undefined;
}

/**
 * Resolves the active GitHub username:
 * 1. Explicitly provided username (or GITHUB_USERNAME env var)
 * 2. Authenticated user profile via GET /user if token is available
 */
export async function resolveActiveUsername(options: { token?: string; username?: string } = {}): Promise<string | undefined> {
  const explicit = options.username || process.env.GITHUB_USERNAME?.trim();
  if (explicit) return explicit;

  const token = options.token || process.env.GITHUB_TOKEN;
  if (!token) return undefined;

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Starred-Repos-Classifier/1.0',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { login?: string };
      return data.login;
    }
  } catch {
    // Non-fatal fallback
  }
  return undefined;
}

/**
 * Fetches starred repositories from GitHub API.
 * - If options.username (or GITHUB_USERNAME) is provided: calls GET /users/{username}/starred
 * - If no username is provided: calls GET /user/starred (requires token)
 * Uses pagination with 100 items per page until all pages are retrieved.
 */
export async function fetchAllStarredRepos(options: FetchOptions = {}): Promise<NormalizedRepo[]> {
  const username = options.username || process.env.GITHUB_USERNAME?.trim();
  const token = options.token || process.env.GITHUB_TOKEN;

  if (!username && !token) {
    throw new Error(
      'GitHub token is required to fetch starred repositories. Please set GITHUB_TOKEN environment variable.'
    );
  }

  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? Infinity;
  const allRepos: NormalizedRepo[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    const url = username
      ? `https://api.github.com/users/${encodeURIComponent(username)}/starred?per_page=${perPage}&page=${page}`
      : `https://api.github.com/user/starred?per_page=${perPage}&page=${page}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Starred-Repos-Classifier/1.0',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (networkError) {
      throw new Error(`Network failure while requesting GitHub API on page ${page}: ${networkError instanceof Error ? networkError.message : String(networkError)}`);
    }

    // Check rate limits
    const remaining = response.headers.get('x-ratelimit-remaining');
    const resetTimestamp = response.headers.get('x-ratelimit-reset');
    const resetDate = resetTimestamp ? new Date(parseInt(resetTimestamp, 10) * 1000) : undefined;

    if (response.status === 401) {
      throw new GitHubApiError('GitHub authentication failed: Invalid or expired GITHUB_TOKEN.', 401, response.statusText);
    }

    if (response.status === 404 && username) {
      throw new GitHubApiError(`GitHub user "${username}" was not found (404).`, 404, response.statusText);
    }

    if (response.status === 403 || response.status === 429) {
      if (remaining === '0') {
        const resetMsg = resetDate ? ` Rate limit resets at ${resetDate.toLocaleTimeString()}.` : '';
        throw new GitHubApiError(`GitHub API rate limit exceeded.${resetMsg}`, response.status, response.statusText, resetDate);
      }
      throw new GitHubApiError(`GitHub API access forbidden: ${response.statusText}`, response.status, response.statusText);
    }

    if (!response.ok) {
      throw new GitHubApiError(`GitHub API returned status ${response.status}: ${response.statusText}`, response.status, response.statusText);
    }

    let items: unknown;
    try {
      items = await response.json();
    } catch {
      throw new Error(`Malformed JSON response from GitHub API on page ${page}.`);
    }

    if (!Array.isArray(items)) {
      throw new Error(`Expected array of repositories from GitHub API on page ${page}, received ${typeof items}.`);
    }

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    for (const item of items) {
      allRepos.push(normalizeRepo(item as RawGitHubRepo));
    }

    if (options.onPageFetched) {
      options.onPageFetched(page, items.length);
    }

    // Check if there are fewer items than requested perPage, meaning this is the last page
    if (items.length < perPage) {
      hasMore = false;
      break;
    }

    // Also check Link header for rel="next" if available
    const linkHeader = response.headers.get('link');
    if (linkHeader && !linkHeader.includes('rel="next"')) {
      hasMore = false;
      break;
    }

    page++;
  }

  return allRepos;
}
