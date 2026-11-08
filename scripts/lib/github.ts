import {
  GitHubApiError,
  fetchStarredRepos,
  getAuthenticatedUser,
  type AuthenticatedUser,
  type FetchStarredReposOptions,
} from '../../src/core/github.ts';
import type { NormalizedRepo } from '../../src/core/normalize.ts';

export type { AuthenticatedUser, FetchStarredReposOptions };
export { GitHubApiError, fetchStarredRepos, getAuthenticatedUser };

export interface FetchOptions {
  token?: string;
  username?: string;
  perPage?: number;
  maxPages?: number;
  onPageFetched?: (page: number, count: number) => void;
  onPage?: (page: number, count: number) => void;
  tokenOwnerLogin?: string;
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
    const user = await getAuthenticatedUser(token);
    return user.login;
  } catch {
    return undefined;
  }
}

/**
 * Fetches starred repositories from GitHub API.
 * Delegates to src/core/github.ts fetchStarredRepos with environment variable fallbacks.
 */
export async function fetchAllStarredRepos(options: FetchOptions = {}): Promise<NormalizedRepo[]> {
  const username = options.username || process.env.GITHUB_USERNAME?.trim();
  const token = options.token || process.env.GITHUB_TOKEN;

  return fetchStarredRepos({
    ...options,
    username,
    token,
    onPage: options.onPage || options.onPageFetched,
  });
}
