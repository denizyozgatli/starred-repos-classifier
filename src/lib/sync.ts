import { getAuthenticatedUser, fetchStarredRepos, GitHubApiError } from '../core/github.ts';
import { fetchUserStarLists, mergeStarLists } from '../core/star-lists.ts';
import { classifyRepos, type ClassificationCache } from '../core/classify-repos.ts';
import { classifyWithRules, type ClassificationResult } from '../core/classifier.ts';
import {
  createLLMClassifier,
  type LLMProviderId,
  LLMRateLimitError,
  LLMAuthError,
} from '../core/llm.ts';
import { RateLimiter } from '../core/rate-limiter.ts';
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

export type LLMSyncStatus = 'disabled' | 'ok' | 'partial' | 'quota_exceeded' | 'invalid_key';
export type GeminiSyncStatus = LLMSyncStatus;

export type SyncPhase = 'fetching' | 'classifying' | 'llm' | 'waiting';

export interface SyncProgress {
  phase: SyncPhase;
  done: number;
  total?: number;
  page?: number;
  repoName?: string;
  currentRepo?: string;
  llmErrors?: number;
  waitingMs?: number;
  isThrottled?: boolean;
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
  llmStatus: LLMSyncStatus;
  llmErrors?: number;
  geminiStatus: LLMSyncStatus;
  geminiErrors?: number;
}

export interface LLMSyncOptions {
  provider?: LLMProviderId;
  apiKey: string;
  model?: string;
  minIntervalSec?: number;
  minIntervalMs?: number;
  adaptive?: boolean;
  allowModelHeal?: boolean;
  onModelFallback?: (pickedModel: string) => void;
}
export type GeminiSyncOptions = LLMSyncOptions;

export interface SyncStarredReposOptions {
  token: string;
  store: KeyValueStore;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
  llm?: LLMSyncOptions;
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
  const { token, store, signal, onProgress, ignoreOtherCache } = options;
  const effectiveLlm: LLMSyncOptions | undefined =
    options.llm ?? (options.gemini ? { provider: 'google', ...options.gemini } : undefined);

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

    let llmStatus: LLMSyncStatus = 'disabled';
    let llmErrorCount = 0;
    let quotaExceeded = false;
    let invalidKey = false;
    let llmAttemptCount = 0;
    let llmClassify: ((repo: NormalizedRepo) => Promise<ClassificationResult>) | undefined = undefined;

    if (effectiveLlm && effectiveLlm.apiKey.trim()) {
      llmStatus = 'ok';
      const provider = effectiveLlm.provider || 'google';
      const minIntervalMs =
        effectiveLlm.minIntervalMs ??
        (effectiveLlm.minIntervalSec ? effectiveLlm.minIntervalSec * 1000 : undefined);

      const rateLimiter = new RateLimiter({ minIntervalMs });
      let currentRepoName: string | undefined = undefined;

      const classifier = createLLMClassifier({
        provider,
        apiKey: effectiveLlm.apiKey.trim(),
        model: effectiveLlm.model,
        minIntervalMs,
        adaptive: effectiveLlm.adaptive,
        rateLimiter,
        signal,
        allowModelHeal: effectiveLlm.allowModelHeal,
        onModelFallback: effectiveLlm.onModelFallback,
        onThrottle: (throttleWaitMs: number) => {
          onProgress?.({
            phase: 'waiting',
            done: llmAttemptCount,
            total: totalLlm,
            repoName: currentRepoName,
            currentRepo: currentRepoName,
            llmErrors: llmErrorCount,
            waitingMs: throttleWaitMs,
            isThrottled: true,
          });
        },
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

        if (quotaExceeded || invalidKey) {
          return {
            category: 'Other',
            method: 'fallback',
            confidence: 0.5,
          };
        }

        currentRepoName = repo.name;
        const waitMs = Math.round(rateLimiter.getMinIntervalMs() || 4000);

        // Emit one extra onProgress right BEFORE the rate limiter wait with waitingMs set
        onProgress?.({
          phase: 'waiting',
          done: llmAttemptCount,
          total: totalLlm,
          repoName: repo.name,
          currentRepo: repo.name,
          llmErrors: llmErrorCount,
          waitingMs: waitMs,
          isThrottled: false,
        });

        llmAttemptCount++;
        onProgress?.({
          phase: 'llm',
          done: llmAttemptCount,
          total: totalLlm,
          repoName: repo.name,
          currentRepo: repo.name,
          llmErrors: llmErrorCount,
          waitingMs: waitMs,
        });

        try {
          const result = await classifier(repo);
          onProgress?.({
            phase: 'llm',
            done: llmAttemptCount,
            total: totalLlm,
            repoName: repo.name,
            currentRepo: repo.name,
            llmErrors: llmErrorCount,
            waitingMs: undefined,
          });
          return result;
        } catch (err) {
          if (signal?.aborted) {
            throw err;
          }
          if (err instanceof LLMAuthError) {
            invalidKey = true;
            llmStatus = 'invalid_key';
            console.warn(`[sync] LLM authentication error for ${provider}:`, err.message);
            return {
              category: 'Other',
              method: 'fallback',
              confidence: 0.5,
            };
          }
          if (err instanceof LLMRateLimitError || (err instanceof Error && err.name === 'GeminiQuotaError')) {
            quotaExceeded = true;
            llmStatus = 'quota_exceeded';
            console.warn('[sync] LLM rate limit or quota exceeded:', err.message);
            return {
              category: 'Other',
              method: 'fallback',
              confidence: 0.5,
            };
          }
          llmErrorCount++;
          console.warn(`[sync] LLM classification error for ${repo.fullName}:`, err instanceof Error ? err.message : String(err));
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
            currentRepo: repo.name,
          });
        },
      }
    );

    if (effectiveLlm && effectiveLlm.apiKey.trim()) {
      if (invalidKey) {
        llmStatus = 'invalid_key';
      } else if (quotaExceeded) {
        llmStatus = 'quota_exceeded';
      } else if (llmErrorCount > 0) {
        llmStatus = 'partial';
      } else {
        llmStatus = 'ok';
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
      llmStatus,
      llmErrors: llmErrorCount > 0 ? llmErrorCount : undefined,
      geminiStatus: llmStatus,
      geminiErrors: llmErrorCount > 0 ? llmErrorCount : undefined,
    };
  } catch (err) {
    throw mapToSyncError(err);
  }
}
