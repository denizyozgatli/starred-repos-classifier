import {
  fetchUserStarLists as coreFetchUserStarLists,
  mergeStarLists,
  type FetchStarListsOptions,
  type StarListsLogger,
} from '../../src/core/star-lists.ts';

export interface StarListOptions {
  token?: string;
  username?: string;
  isViewer?: boolean;
  signal?: AbortSignal;
  logger?: StarListsLogger;
}

export { mergeStarLists, type FetchStarListsOptions, type StarListsLogger };

/**
 * Fetches all Star Lists and their repository memberships for a user.
 * Delegates to src/core/star-lists.ts with environment variable fallbacks.
 */
export async function fetchUserStarLists(options: StarListOptions = {}): Promise<Map<string, string[]>> {
  const token = options.token || process.env.GITHUB_TOKEN;
  const username = options.username || process.env.GITHUB_USERNAME?.trim();
  const isViewer = options.isViewer !== undefined ? options.isViewer : !username;

  return coreFetchUserStarLists({
    token,
    username,
    isViewer,
    signal: options.signal,
    logger: options.logger || console,
  });
}
