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
  userAgent?: string;
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
    this.isRateLimit = isRateLimit ?? (status === 429 || rateLimitRemaining === 0);
  }
}

function getGitHubHeaders(token?: string, userAgent?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (userAgent && userAgent.trim()) {
    headers['User-Agent'] = userAgent.trim();
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleGitHubErrors(response: Response, username?: string): Promise<void> {
  const remainingHeader = response.headers?.get('x-ratelimit-remaining');
  const remaining = remainingHeader !== null && remainingHeader !== undefined ? parseInt(remainingHeader, 10) : undefined;
  const resetTimestamp = response.headers?.get('x-ratelimit-reset');
  const resetDate = resetTimestamp ? new Date(parseInt(resetTimestamp, 10) * 1000) : undefined;

  const retryAfterHeader = response.headers?.get('retry-after');
  let retryAfterDate: Date | undefined;
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(seconds)) {
      retryAfterDate = new Date(Date.now() + seconds * 1000);
    } else {
      const parsed = Date.parse(retryAfterHeader);
      if (!Number.isNaN(parsed)) {
        retryAfterDate = new Date(parsed);
      }
    }
  }

  const effectiveResetDate = retryAfterDate || resetDate;

  if (response.status === 401) {
    throw new GitHubApiError('GitHub authentication failed: invalid or expired token.', 401, response.statusText);
  }

  if (response.status === 404 && username) {
    throw new GitHubApiError(`GitHub user "${username}" was not found (404).`, 404, response.statusText);
  }

  if (response.status === 403 || response.status === 429) {
    const isRateLimited = response.status === 429 || remaining === 0 || retryAfterHeader !== null;
    if (isRateLimited) {
      const resetMsg = effectiveResetDate ? ` Rate limit resets at ${effectiveResetDate.toLocaleTimeString()}.` : '';
      throw new GitHubApiError(
        `GitHub API rate limit exceeded.${resetMsg}`,
        response.status,
        response.statusText,
        effectiveResetDate,
        remaining,
        true
      );
    }

    // Non-rate-limit 403 (insufficient permissions)
    let bodyMessage: string | null = null;
    try {
      const cloned = response.clone();
      const body = await cloned.json();
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
        bodyMessage = body.message;
      }
    } catch {
      // Ignore body parsing failure
    }

    const permMsg = 'This token cannot read your stars. Edit the token and set Account permissions → Starring → Read-only.';
    throw new GitHubApiError(
      permMsg,
      response.status,
      response.statusText || bodyMessage || 'Forbidden',
      resetDate,
      remaining,
      false
    );
  }

  if (!response.ok) {
    throw new GitHubApiError(`GitHub API returned status ${response.status}: ${response.statusText}`, response.status, response.statusText);
  }
}

export interface GetAuthenticatedUserOptions {
  signal?: AbortSignal;
  userAgent?: string;
}

/**
 * Retrieves the profile of the authenticated user using GET /user.
 */
export async function getAuthenticatedUser(
  token: string,
  optionsOrSignal?: AbortSignal | GetAuthenticatedUserOptions,
  userAgentParam?: string
): Promise<AuthenticatedUser> {
  let signal: AbortSignal | undefined;
  let userAgent: string | undefined = userAgentParam;

  if (optionsOrSignal) {
    if (typeof optionsOrSignal === 'object' && 'aborted' in optionsOrSignal) {
      signal = optionsOrSignal as AbortSignal;
    } else {
      signal = (optionsOrSignal as GetAuthenticatedUserOptions).signal;
      if ((optionsOrSignal as GetAuthenticatedUserOptions).userAgent) {
        userAgent = (optionsOrSignal as GetAuthenticatedUserOptions).userAgent;
      }
    }
  }

  const headers = getGitHubHeaders(token, userAgent);
  let response: Response;
  try {
    response = await fetch('https://api.github.com/user', { headers, signal });
  } catch (error) {
    throw new Error(`Network failure while requesting GitHub API /user: ${error instanceof Error ? error.message : String(error)}`);
  }

  await handleGitHubErrors(response);

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
  const { token, username, signal, userAgent } = options;
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
        const authUser = await getAuthenticatedUser(token, { signal, userAgent });
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

    const headers = getGitHubHeaders(token, userAgent);

    let response: Response;
    try {
      response = await fetch(url, { headers, signal });
    } catch (networkError) {
      throw new Error(`Network failure while requesting GitHub API on page ${page}: ${networkError instanceof Error ? networkError.message : String(networkError)}`);
    }

    await handleGitHubErrors(response, username);

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
