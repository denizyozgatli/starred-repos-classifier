import { getAuthenticatedUser, fetchStarredRepos, GitHubApiError } from '../core/github.ts';
import { fetchUserStarLists, mergeStarLists } from '../core/star-lists.ts';
import { classifyRepos, type ClassificationCache } from '../core/classify-repos.ts';
import { buildDatasetEnvelope } from '../core/dataset.ts';
import type { DatasetEnvelope } from '../types/repo.ts';
import type { KeyValueStore } from './storage/datasetStore.ts';

export type SyncErrorCode =
  | 'invalid_token'
  | 'insufficient_permissions'
  | 'rate_limited'
  | 'network'
  | 'aborted'
  | 'unknown';

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly status?: number;
  readonly resetTime?: Date;

  constructor(
    message: string,
    code: SyncErrorCode,
    options?: { status?: number; resetTime?: Date; cause?: unknown }
  ) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.status = options?.status;
    this.resetTime = options?.resetTime;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export function mapToSyncError(err: unknown): SyncError {
  if (err instanceof SyncError) {
    return err;
  }

  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.message.toLowerCase().includes('abort')) {
      return new SyncError('Sync operation was aborted.', 'aborted', { cause: err });
    }
  }

  if (err instanceof GitHubApiError) {
    if (err.status === 401) {
      return new SyncError(
        'Invalid GitHub personal access token. Please verify your token and permissions.',
        'invalid_token',
        { status: 401, cause: err }
      );
    }

    if (
      err.isRateLimit ||
      err.status === 429 ||
      (err.status === 403 && err.rateLimitRemaining === 0) ||
      (err.status === 403 && Boolean(err.rateLimitReset))
    ) {
      const resetDate = err.rateLimitReset;
      const resetStr = resetDate ? ` Resets at ${resetDate.toLocaleTimeString()}.` : '';
      return new SyncError(
        `GitHub API rate limit exceeded.${resetStr}`,
        'rate_limited',
        { status: err.status, resetTime: resetDate, cause: err }
      );
    }

    if (err.status === 403) {
      return new SyncError(
        err.message || 'Token has insufficient permissions to read starred repositories.',
        'insufficient_permissions',
        { status: 403, cause: err }
      );
    }

    return new SyncError(err.message, 'network', { status: err.status, cause: err });
  }

  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
    return new SyncError(
      'Network error: Failed to connect to GitHub. Please check your internet connection.',
      'network',
      { cause: err }
    );
  }

  return new SyncError(
    err instanceof Error ? err.message : String(err),
    'unknown',
    { cause: err }
  );
}

export interface SyncProgress {
  phase: 'fetching' | 'classifying';
  done: number;
  total?: number;
  page?: number;
  repoName?: string;
}

export interface SyncStats {
  total: number;
  cacheHits: number;
  newlyClassified: number;
}

export interface SyncResult {
  envelope: DatasetEnvelope;
  listsUnavailable: boolean;
  stats: SyncStats;
}

export interface SyncStarredReposOptions {
  token: string;
  store: KeyValueStore;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}

export const DEFAULT_MAX_CACHE_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

export function shouldAutoRefresh(
  lastSyncAt: string | number | Date | null | undefined,
  now: number | string | Date = Date.now(),
  maxAgeMs: number = DEFAULT_MAX_CACHE_AGE_MS
): boolean {
  if (!lastSyncAt) return true;

  const lastSyncTime =
    typeof lastSyncAt === 'number'
      ? lastSyncAt
      : lastSyncAt instanceof Date
      ? lastSyncAt.getTime()
      : Date.parse(String(lastSyncAt));

  if (Number.isNaN(lastSyncTime)) return true;

  const currentTime =
    typeof now === 'number'
      ? now
      : now instanceof Date
      ? now.getTime()
      : Date.parse(String(now));

  if (Number.isNaN(currentTime)) return true;

  return currentTime - lastSyncTime >= maxAgeMs;
}

/**
 * Executes full client-side synchronization:
 * 1. Authenticates token via GET /user
 * 2. Fetches starred repositories via GitHub REST API
 * 3. Fetches star lists via GitHub GraphQL (best-effort)
 * 4. Merges lists and classifies repositories with rules-only engine
 * 5. Persists dataset envelope, cache, and metadata to storage
 */
export async function syncStarredRepos(options: SyncStarredReposOptions): Promise<SyncResult> {
  const { token, store, signal, onProgress } = options;

  if (signal?.aborted) {
    throw new SyncError('Sync operation was aborted.', 'aborted');
  }

  try {
    // Step a: Authenticate user
    const user = await getAuthenticatedUser(token, signal);
    const login = user.login;

    if (signal?.aborted) {
      throw new SyncError('Sync operation was aborted.', 'aborted');
    }

    // Step b: Fetch starred repositories
    const rawRepos = await fetchStarredRepos({
      token,
      tokenOwnerLogin: login,
      signal,
      onPage: (page: number, count: number) => {
        onProgress?.({
          phase: 'fetching',
          done: count,
          page,
        });
      },
    });

    if (signal?.aborted) {
      throw new SyncError('Sync operation was aborted.', 'aborted');
    }

    // Step c: Fetch star lists (best effort)
    let listsUnavailable = false;
    let starListsMap = new Map<string, string[]>();
    try {
      starListsMap = await fetchUserStarLists({ token, isViewer: true, signal, throwOnError: true });
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }
      listsUnavailable = true;
      console.warn('[sync] Star lists unavailable with this token:', err instanceof Error ? err.message : String(err));
    }

    if (signal?.aborted) {
      throw new SyncError('Sync operation was aborted.', 'aborted');
    }

    // Step d: Merge star lists and classify repositories
    const mergedRepos = mergeStarLists(rawRepos, starListsMap);
    const storedCache = (await store.get<ClassificationCache>('classificationCache')) || {};

    if (signal?.aborted) {
      throw new SyncError('Sync operation was aborted.', 'aborted');
    }

    const { repos: classifiedRepos, cache: updatedCache, cacheHits, newlyClassified } = await classifyRepos(
      mergedRepos,
      {
        cache: storedCache,
        signal,
        onProgress: (done, total, repo) => {
          onProgress?.({
            phase: 'classifying',
            done,
            total,
            repoName: repo.name,
          });
        },
      }
    );

    if (signal?.aborted) {
      throw new SyncError('Sync operation was aborted.', 'aborted');
    }

    // Step e: Build envelope and persist to store
    const envelope = buildDatasetEnvelope(classifiedRepos, {
      username: login,
    });

    const nowIso = new Date().toISOString();
    await store.set('dataset', envelope);
    await store.set('classificationCache', updatedCache);
    await store.set('lastSyncAt', nowIso);
    await store.set('viewerLogin', login);

    return {
      envelope,
      listsUnavailable,
      stats: {
        total: classifiedRepos.length,
        cacheHits,
        newlyClassified,
      },
    };
  } catch (err) {
    throw mapToSyncError(err);
  }
}
