export interface StarListOptions {
  token?: string;
  username?: string;
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

const USER_LISTS_QUERY = `
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

const VIEWER_LISTS_QUERY = `
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

const LIST_ITEMS_QUERY = `
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
async function executeGraphQL<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Starred-Repos-Classifier/1.0',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL API returned HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as T;
}

/**
 * Fetches all Star Lists and their repository memberships for a user.
 * Returns a Map from lowercased repository fullName ("owner/name") to an array of list names.
 * Fails gracefully and returns an empty Map if lists cannot be retrieved.
 */
export async function fetchUserStarLists(options: StarListOptions = {}): Promise<Map<string, string[]>> {
  const token = options.token || process.env.GITHUB_TOKEN;
  const username = options.username || process.env.GITHUB_USERNAME?.trim();
  const repoToLists = new Map<string, string[]>();

  if (!token) {
    console.log('[star-lists] Notice: No GitHub token provided; GitHub GraphQL API requires authentication for Star Lists.');
    return repoToLists;
  }

  try {
    let hasNextPage = true;
    let cursor: string | null = null;
    const allListNodes: GraphQLUserListNode[] = [];

    while (hasNextPage) {
      const query = username ? USER_LISTS_QUERY : VIEWER_LISTS_QUERY;
      const variables: Record<string, unknown> = username ? { login: username, cursor } : { cursor };

      const res = await executeGraphQL<GraphQLUserListsResponse>(token, query, variables);

      if (res.errors && res.errors.length > 0) {
        const errorMsg = res.errors.map((e: { message: string }) => e.message).join('; ');
        console.warn(`[star-lists] Warning from GraphQL: ${errorMsg}`);
        // If query returned partial or no data, stop pagination gracefully
        if (!res.data?.user?.lists && !res.data?.viewer?.lists) {
          break;
        }
      }

      const listsConnection = (username ? res.data?.user?.lists : res.data?.viewer?.lists) ?? null;
      if (!listsConnection || !Array.isArray(listsConnection.nodes)) {
        break;
      }

      allListNodes.push(...listsConnection.nodes);
      hasNextPage = Boolean(listsConnection.pageInfo?.hasNextPage);
      cursor = listsConnection.pageInfo?.endCursor || null;
    }

    if (allListNodes.length === 0) {
      console.log(`[star-lists] No Star Lists found for ${username ? `@${username}` : 'authenticated user'}.`);
      return repoToLists;
    }

    console.log(`[star-lists] Found ${allListNodes.length} Star List(s). Retrieving items...`);

    for (const list of allListNodes) {
      const listName = list.name?.trim();
      if (!listName) continue;

      const reposInList = new Set<string>();

      // Collect initial items from list connection
      if (Array.isArray(list.items?.nodes)) {
        for (const item of list.items.nodes) {
          if (item?.nameWithOwner) {
            reposInList.add(item.nameWithOwner.toLowerCase());
          }
        }
      }

      // If list has more than 100 items, paginate remaining items
      let itemsHasNext = Boolean(list.items?.pageInfo?.hasNextPage);
      let itemsCursor = list.items?.pageInfo?.endCursor || null;

      while (itemsHasNext && itemsCursor) {
        try {
          const itemsRes = await executeGraphQL<GraphQLListItemsResponse>(token, LIST_ITEMS_QUERY, {
            listId: list.id,
            cursor: itemsCursor,
          });

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
          console.warn(`[star-lists] Warning: Failed to fetch subsequent page of items for list "${listName}":`, itemErr);
          break;
        }
      }

      console.log(`  - Star List "${listName}": ${reposInList.size} repos`);

      for (const repoName of reposInList) {
        const existing = repoToLists.get(repoName) || [];
        if (!existing.includes(listName)) {
          existing.push(listName);
        }
        repoToLists.set(repoName, existing);
      }
    }

    console.log(`[star-lists] Successfully mapped Star Lists for ${repoToLists.size} unique repositories.`);
  } catch (error) {
    console.warn(
      '[star-lists] Warning: Failed to retrieve Star Lists via GitHub GraphQL API. Proceeding with empty lists:',
      error instanceof Error ? error.message : String(error)
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
