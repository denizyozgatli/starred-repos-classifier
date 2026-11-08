import { normalizeRepo, type NormalizedRepo, type RawGitHubRepo } from './normalize.ts';

export interface AuthenticatedUser {
  login: string;
  avatarUrl?: string;
  name?: string;
}

export interface FetchStarredReposOptions {
  token?: string;
  username?: string;
  signal?: AbortSignal;
  onPage?: (page: number, count: number) => void;
  onPageFetched?: (page: number, count: number) => void;
  perPage?: number;
  maxPages?: number;
  tokenOwnerLogin?: string;
}

export class GitHubApiError extends Error {
  status: number;
  statusText: string;
  rateLimitReset?: Date;
  rateLimitRemaining?: number;
  isRateLimit?: boolean;

  constructor(
    message: string,
    status: number,
    statusText: string,
    rateLimitReset?: Date,
    rateLimitRemaining?: number,
    isRateLimit?: boolean
  ) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.statusText = statusText;
    this.rateLimitReset = rateLimitReset;
    this.rateLimitRemaining = rateLimitRemaining;
    this.isRateLimit = isRateLimit ?? (Boolean(rateLimitReset) || status === 429);
  }
}

function getGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (typeof window === 'undefined') {
    headers['User-Agent'] = 'Starred-Repos-Classifier/1.0';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function handleGitHubErrors(response: Response, username?: string): void {
  const remainingHeader = response.headers?.get('x-ratelimit-remaining');
  const remaining = remainingHeader !== null && remainingHeader !== undefined ? parseInt(remainingHeader, 10) : undefined;
  const resetTimestamp = response.headers?.get('x-ratelimit-reset');
  const resetDate = resetTimestamp ? new Date(parseInt(resetTimestamp, 10) * 1000) : undefined;

  if (response.status === 401) {
    throw new GitHubApiError('GitHub authentication failed: Invalid or expired GITHUB_TOKEN.', 401, response.statusText);
  }

  if (response.status === 404 && username) {
    throw new GitHubApiError(`GitHub user "${username}" was not found (404).`, 404, response.statusText);
  }

  if (response.status === 403 || response.status === 429) {
    if (remaining === 0 || response.status === 429) {
      const resetMsg = resetDate ? ` Rate limit resets at ${resetDate.toLocaleTimeString()}.` : '';
      throw new GitHubApiError(
        `GitHub API rate limit exceeded.${resetMsg}`,
        response.status,
        response.statusText,
        resetDate,
        remaining,
        true
      );
    }
    throw new GitHubApiError(
      `GitHub API access forbidden: ${response.statusText}`,
      response.status,
      response.statusText,
      resetDate,
      remaining,
      false
    );
  }

  if (!response.ok) {
    throw new GitHubApiError(`GitHub API returned status ${response.status}: ${response.statusText}`, response.status, response.statusText);
  }
}

/**
 * Retrieves the profile of the authenticated user using GET /user.
 */
export async function getAuthenticatedUser(
  token: string,
  signal?: AbortSignal
): Promise<AuthenticatedUser> {
  const headers = getGitHubHeaders(token);
  let response: Response;
  try {
    response = await fetch('https://api.github.com/user', { headers, signal });
  } catch (error) {
    throw new Error(`Network failure while requesting GitHub API /user: ${error instanceof Error ? error.message : String(error)}`);
  }

  handleGitHubErrors(response);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Malformed JSON response from GitHub API /user.');
  }

  const user = data as { login?: string; avatar_url?: string; name?: string | null };
  return {
    login: user?.login || '',
    avatarUrl: user?.avatar_url,
    name: user?.name ?? undefined,
  };
}

/**
 * Fetches starred repositories from GitHub API.
 * - If token is provided and (!username or username matches token owner), uses GET /user/starred
 * - If username is provided for a different user or no token exists, uses GET /users/{username}/starred
 */
export async function fetchStarredRepos(options: FetchStarredReposOptions = {}): Promise<NormalizedRepo[]> {
  const { token, username, signal } = options;
  const onPage = options.onPage || options.onPageFetched;
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? Infinity;

  if (!username && !token) {
    throw new Error('GitHub token or username is required.');
  }

  let isViewer = false;
  if (token) {
    if (!username) {
      isViewer = true;
    } else if (options.tokenOwnerLogin) {
      isViewer = username.toLowerCase() === options.tokenOwnerLogin.toLowerCase();
    } else {
      try {
        const authUser = await getAuthenticatedUser(token, signal);
        if (authUser.login && authUser.login.toLowerCase() === username.toLowerCase()) {
          isViewer = true;
        }
      } catch (err) {
        if (err instanceof GitHubApiError && err.status === 401) {
          throw err;
        }
        isViewer = false;
      }
    }
  }

  const allRepos: NormalizedRepo[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    const url = isViewer
      ? `https://api.github.com/user/starred?per_page=${perPage}&page=${page}`
      : `https://api.github.com/users/${encodeURIComponent(username!)}/starred?per_page=${perPage}&page=${page}`;

    const headers = getGitHubHeaders(token);

    let response: Response;
    try {
      response = await fetch(url, { headers, signal });
    } catch (networkError) {
      throw new Error(`Network failure while requesting GitHub API on page ${page}: ${networkError instanceof Error ? networkError.message : String(networkError)}`);
    }

    handleGitHubErrors(response, username);

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

    if (onPage) {
      onPage(page, items.length);
    }

    if (items.length < perPage) {
      hasMore = false;
      break;
    }

    const linkHeader = response.headers.get('link');
    if (linkHeader && !linkHeader.includes('rel="next"')) {
      hasMore = false;
      break;
    }

    page++;
  }

  return allRepos;
}

export const fetchAllStarredRepos = fetchStarredRepos;
