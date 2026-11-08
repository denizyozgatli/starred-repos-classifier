export interface StarListsLogger {
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

export interface FetchStarListsOptions {
  token?: string;
  username?: string;
  isViewer: boolean;
  signal?: AbortSignal;
  logger?: StarListsLogger;
  throwOnError?: boolean;
}

interface GraphQLPageInfo {
  hasNextPage: boolean;
  endCursor?: string | null;
}

interface GraphQLRepoNode {
  nameWithOwner?: string;
}

interface GraphQLUserListNode {
  id: string;
  name: string;
  description?: string | null;
  items: {
    pageInfo: GraphQLPageInfo;
    totalCount: number;
    nodes: GraphQLRepoNode[];
  };
}

interface GraphQLUserListsResponse {
  data?: {
    user?: {
      lists: {
        pageInfo: GraphQLPageInfo;
        totalCount: number;
        nodes: GraphQLUserListNode[];
      };
    };
    viewer?: {
      lists: {
        pageInfo: GraphQLPageInfo;
        totalCount: number;
        nodes: GraphQLUserListNode[];
      };
    };
  };
  errors?: Array<{ message: string }>;
}

interface GraphQLListItemsResponse {
  data?: {
    node?: {
      items: {
        pageInfo: GraphQLPageInfo;
        nodes: GraphQLRepoNode[];
      };
    };
  };
  errors?: Array<{ message: string }>;
}

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

export const USER_LISTS_QUERY = `
  query GetUserStarLists($login: String!, $cursor: String) {
    user(login: $login) {
      lists(first: 50, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        totalCount
        nodes {
          id
          name
          description
          items(first: 100) {
            pageInfo {
              hasNextPage
              endCursor
            }
            totalCount
            nodes {
              ... on Repository {
                nameWithOwner
              }
            }
          }
        }
      }
    }
  }
`;

export const VIEWER_LISTS_QUERY = `
  query GetViewerStarLists($cursor: String) {
    viewer {
      lists(first: 50, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        totalCount
        nodes {
          id
          name
          description
          items(first: 100) {
            pageInfo {
              hasNextPage
              endCursor
            }
            totalCount
            nodes {
              ... on Repository {
                nameWithOwner
              }
            }
          }
        }
      }
    }
  }
`;

export const LIST_ITEMS_QUERY = `
  query GetListItems($listId: ID!, $cursor: String) {
    node(id: $listId) {
      ... on UserList {
        items(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ... on Repository {
              nameWithOwner
            }
          }
        }
      }
    }
  }
`;

/**
 * Executes a GraphQL query against GitHub's API.
 */
async function executeGraphQL<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (typeof window === 'undefined') {
    headers['User-Agent'] = 'Starred-Repos-Classifier/1.0';
  }

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL API returned HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as T;
}

/**
 * Fetches all Star Lists and their repository memberships for a user or the authenticated viewer.
 * When isViewer is true, uses the VIEWER query to retrieve all star lists (including private lists).
 * When isViewer is false, uses the USER query with username.
 */
export function fetchUserStarLists(options: FetchStarListsOptions): Promise<Map<string, string[]>>;
export function fetchUserStarLists(
  token: string | undefined,
  username: string | undefined,
  isViewer: boolean,
  signal?: AbortSignal,
  logger?: StarListsLogger
): Promise<Map<string, string[]>>;
export async function fetchUserStarLists(
  optionsOrToken?: FetchStarListsOptions | string,
  usernameParam?: string,
  isViewerParam?: boolean,
  signalParam?: AbortSignal,
  loggerParam?: StarListsLogger
): Promise<Map<string, string[]>> {
  let token: string | undefined;
  let username: string | undefined;
  let isViewer = false;
  let signal: AbortSignal | undefined;
  let logger: StarListsLogger | undefined;
  let throwOnError = false;

  if (typeof optionsOrToken === 'object' && optionsOrToken !== null) {
    token = optionsOrToken.token;
    username = optionsOrToken.username;
    isViewer = Boolean(optionsOrToken.isViewer);
    signal = optionsOrToken.signal;
    logger = optionsOrToken.logger;
    throwOnError = Boolean(optionsOrToken.throwOnError);
  } else {
    token = optionsOrToken;
    username = usernameParam;
    isViewer = Boolean(isViewerParam);
    signal = signalParam;
    logger = loggerParam;
  }

  const log = logger?.log ?? (() => {});
  const warn = logger?.warn ?? (() => {});
  const repoToLists = new Map<string, string[]>();

  if (!token) {
    log('[star-lists] Notice: No GitHub token provided; GitHub GraphQL API requires authentication for Star Lists.');
    return repoToLists;
  }

  try {
    let hasNextPage = true;
    let cursor: string | null = null;
    const allListNodes: GraphQLUserListNode[] = [];

    while (hasNextPage) {
      const query = isViewer ? VIEWER_LISTS_QUERY : USER_LISTS_QUERY;
      const variables: Record<string, unknown> = isViewer ? { cursor } : { login: username, cursor };

      const res = await executeGraphQL<GraphQLUserListsResponse>(token, query, variables, signal);

      if (res.errors && res.errors.length > 0) {
        const errorMsg = res.errors.map((e: { message: string }) => e.message).join('; ');
        warn(`[star-lists] Warning from GraphQL: ${errorMsg}`);
        if (!res.data?.user?.lists && !res.data?.viewer?.lists) {
          if (throwOnError) {
            throw new Error(errorMsg);
          }
          break;
        }
      }

      const listsConnection = (isViewer ? res.data?.viewer?.lists : res.data?.user?.lists) ?? null;
      if (!listsConnection || !Array.isArray(listsConnection.nodes)) {
        break;
      }

      allListNodes.push(...listsConnection.nodes);
      hasNextPage = Boolean(listsConnection.pageInfo?.hasNextPage);
      cursor = listsConnection.pageInfo?.endCursor || null;
    }

    if (allListNodes.length === 0) {
      log(`[star-lists] No Star Lists found for ${isViewer ? 'authenticated user' : `@${username}`}.`);
      return repoToLists;
    }

    log(`[star-lists] Found ${allListNodes.length} Star List(s). Retrieving items...`);

    for (const list of allListNodes) {
      const listName = list.name?.trim();
      if (!listName) continue;

      const reposInList = new Set<string>();

      if (Array.isArray(list.items?.nodes)) {
        for (const item of list.items.nodes) {
          if (item?.nameWithOwner) {
            reposInList.add(item.nameWithOwner.toLowerCase());
          }
        }
      }

      let itemsHasNext = Boolean(list.items?.pageInfo?.hasNextPage);
      let itemsCursor = list.items?.pageInfo?.endCursor || null;

      while (itemsHasNext && itemsCursor) {
        try {
          const itemsRes = await executeGraphQL<GraphQLListItemsResponse>(token, LIST_ITEMS_QUERY, {
            listId: list.id,
            cursor: itemsCursor,
          }, signal);

          const nodeItems = itemsRes.data?.node?.items;
          if (Array.isArray(nodeItems?.nodes)) {
            for (const item of nodeItems.nodes) {
              if (item?.nameWithOwner) {
                reposInList.add(item.nameWithOwner.toLowerCase());
              }
            }
          }

          itemsHasNext = Boolean(nodeItems?.pageInfo?.hasNextPage);
          itemsCursor = nodeItems?.pageInfo?.endCursor || null;
        } catch (itemErr) {
          warn(
            `[star-lists] Warning: Failed to fetch subsequent page of items for list "${listName}": ${itemErr instanceof Error ? itemErr.message : String(itemErr)}`
          );
          break;
        }
      }

      log(`  - Star List "${listName}": ${reposInList.size} repos`);

      for (const repoName of reposInList) {
        const existing = repoToLists.get(repoName) || [];
        if (!existing.includes(listName)) {
          existing.push(listName);
        }
        repoToLists.set(repoName, existing);
      }
    }

    log(`[star-lists] Successfully mapped Star Lists for ${repoToLists.size} unique repositories.`);
  } catch (error) {
    if (throwOnError) {
      throw error;
    }
    warn(
      `[star-lists] Warning: Failed to retrieve Star Lists via GitHub GraphQL API. Proceeding with empty lists: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return repoToLists;
}

/**
 * Merges Star List memberships onto an array of repositories.
 */
export function mergeStarLists<T extends { fullName: string; lists?: string[] }>(
  repos: T[],
  starListsMap: Map<string, string[]>
): T[] {
  return repos.map(repo => {
    const matchedLists = starListsMap.get(repo.fullName.toLowerCase()) || [];
    return {
      ...repo,
      lists: matchedLists,
    };
  });
}
