import { getAuthenticatedUser, fetchStarredRepos, GitHubApiError } from '../core/github.ts';
import { fetchUserStarLists, mergeStarLists } from '../core/star-lists.ts';
import { classifyRepos, type ClassificationCache } from '../core/classify-repos.ts';
import { classifyWithRules, type ClassificationResult } from '../core/classifier.ts';
import { createGeminiClassifier, GeminiQuotaError, GEMINI_MODEL } from '../core/llm.ts';
import { computeInputHash } from '../core/hash.ts';
import { buildDatasetEnvelope } from '../core/dataset.ts';
import type { DatasetEnvelope } from '../types/repo.ts';
import type { NormalizedRepo } from '../core/normalize.ts';
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
        'GitHub authentication failed: invalid or expired token.',
        'invalid_token',
        { status: 401, cause: err }
      );
    }

    const isRateLimit =
      err.isRateLimit === true ||
      err.status === 429 ||
      (err.status === 403 && err.rateLimitRemaining === 0);

    if (isRateLimit) {
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
        'This token cannot read your stars. Edit the token and set Account permissions → Starring → Read-only.',
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

export type GeminiSyncStatus = 'disabled' | 'ok' | 'partial' | 'quota_exceeded';

export interface SyncProgress {
  phase: 'fetching' | 'classifying' | 'llm';
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
  geminiStatus: GeminiSyncStatus;
  geminiErrors?: number;
}

export interface GeminiSyncOptions {
  apiKey: string;
  model?: string;
  minIntervalMs?: number;
}

export interface SyncStarredReposOptions {
  token: string;
  store: KeyValueStore;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
  gemini?: GeminiSyncOptions;
  ignoreOtherCache?: boolean;
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

export interface SyncFailureResolution {
  shouldClearToken: boolean;
  bannerMessage: string | null;
  keepCachedDataset: boolean;
  showConnectScreen: boolean;
}

/**
 * Determines error handling policy for sync failures.
 * If token is invalid (401), clears the stored token and provides
 * a banner message if a cached dataset exists to prevent data disappearance.
 */
export function resolveSyncFailure(
  error: SyncError,
  hasCachedDataset: boolean
): SyncFailureResolution {
  if (error.code === 'invalid_token') {
    return {
      shouldClearToken: true,
      bannerMessage: hasCachedDataset ? 'Your token is no longer valid — reconnect' : null,
      keepCachedDataset: hasCachedDataset,
      showConnectScreen: !hasCachedDataset,
    };
  }

  return {
    shouldClearToken: false,
    bannerMessage: null,
    keepCachedDataset: hasCachedDataset,
    showConnectScreen: !hasCachedDataset,
  };
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
  const { token, store, signal, onProgress, gemini, ignoreOtherCache } = options;

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
    let storedCache = (await store.get<ClassificationCache>('classificationCache')) || {};

    if (ignoreOtherCache) {
      const filtered: ClassificationCache = {};
      for (const [fullName, entry] of Object.entries(storedCache)) {
        if (entry.category !== 'Other') {
          filtered[fullName] = entry;
        }
      }
      storedCache = filtered;
    }

    if (signal?.aborted) {
      throw new SyncError('Sync operation was aborted.', 'aborted');
    }

    let geminiStatus: GeminiSyncStatus = 'disabled';
    let geminiErrorCount = 0;
    let quotaExceeded = false;
    let geminiAttemptCount = 0;
    let llmClassify: ((repo: NormalizedRepo) => Promise<ClassificationResult>) | undefined = undefined;

    if (gemini && gemini.apiKey.trim()) {
      geminiStatus = 'ok';
      const classifier = createGeminiClassifier({
        apiKey: gemini.apiKey.trim(),
        model: gemini.model || GEMINI_MODEL,
        minIntervalMs: gemini.minIntervalMs,
        signal,
      });

      // Calculate total LLM attempts needed for progress reporting
      const uncachedUnmatched = mergedRepos.filter(r => {
        const hash = computeInputHash(r);
        const cached = storedCache[r.fullName];
        if (cached && cached.classification?.inputHash === hash) return false;
        return classifyWithRules(r) === null;
      });
      const totalLlm = uncachedUnmatched.length;

      llmClassify = async (repo: NormalizedRepo): Promise<ClassificationResult> => {
        const ruleResult = classifyWithRules(repo);
        if (ruleResult) {
          return ruleResult;
        }

        if (quotaExceeded) {
          return {
            category: 'Other',
            method: 'fallback',
            confidence: 0.5,
          };
        }

        geminiAttemptCount++;
        onProgress?.({
          phase: 'llm',
          done: geminiAttemptCount,
          total: totalLlm,
          repoName: repo.name,
        });

        try {
          return await classifier(repo);
        } catch (err) {
          if (signal?.aborted) {
            throw err;
          }
          if (err instanceof GeminiQuotaError) {
            quotaExceeded = true;
            geminiStatus = 'quota_exceeded';
            console.warn('[sync] Gemini quota exceeded:', err.message);
            return {
              category: 'Other',
              method: 'fallback',
              confidence: 0.5,
            };
          }
          geminiErrorCount++;
          console.warn(`[sync] Gemini classification error for ${repo.fullName}:`, err instanceof Error ? err.message : String(err));
          return {
            category: 'Other',
            method: 'fallback',
            confidence: 0.5,
          };
        }
      };
    }

    const { repos: classifiedRepos, cache: updatedCache, cacheHits, newlyClassified } = await classifyRepos(
      mergedRepos,
      {
        cache: storedCache,
        signal,
        llmClassify,
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

    if (gemini && gemini.apiKey.trim()) {
      if (quotaExceeded) {
        geminiStatus = 'quota_exceeded';
      } else if (geminiErrorCount > 0) {
        geminiStatus = 'partial';
      } else {
        geminiStatus = 'ok';
      }
    }

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
      geminiStatus,
      geminiErrors: geminiErrorCount > 0 ? geminiErrorCount : undefined,
    };
  } catch (err) {
    throw mapToSyncError(err);
  }
}
