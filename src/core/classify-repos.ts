import type { NormalizedRepo } from './normalize.ts';
import { computeInputHash } from './hash.ts';
import { classifyWithRules, type ClassificationResult } from './classifier.ts';
import type {
  Repository,
  RepositoryCategory,
  ClassificationMethod,
  ClassificationMeta,
} from './types.ts';

export const LLM_OTHER_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface CacheEntry {
  category: RepositoryCategory;
  classification: ClassificationMeta;
}

export type ClassificationCache = Record<string, CacheEntry>;

export interface ClassifyReposOptions {
  cache?: Record<string, CacheEntry>;
  ruleOnly?: boolean;
  noCache?: boolean;
  llmClassify?: (repo: NormalizedRepo) => Promise<ClassificationResult>;
  onProgress?: (done: number, total: number, repo: NormalizedRepo) => void;
  signal?: AbortSignal;
}

export interface ClassifyReposResult {
  repos: Repository[];
  cache: Record<string, CacheEntry>;
  cacheHits: number;
  newlyClassified: number;
}

/**
 * Classifies an array of normalized repositories using an incremental cache,
 * rule-based heuristic matching, and optional injected LLM fallback.
 */
export async function classifyRepos(
  repos: NormalizedRepo[],
  options: ClassifyReposOptions = {}
): Promise<ClassifyReposResult> {
  const {
    ruleOnly = false,
    noCache = false,
    llmClassify,
    onProgress,
    signal,
  } = options;

  const cache: Record<string, CacheEntry> = options.cache || {};
  const classifiedRepos: Repository[] = [];
  let cacheHits = 0;
  let newlyClassified = 0;

  for (let i = 0; i < repos.length; i++) {
    if (signal?.aborted) {
      if (typeof signal.throwIfAborted === 'function') {
        signal.throwIfAborted();
      }
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }

    const repo = repos[i];
    const inputHash = computeInputHash(repo);
    const cached = cache[repo.fullName];

    const isInputHashMatch = Boolean(cached && cached.classification?.inputHash === inputHash);
    const isLlmOther = cached?.classification?.method === 'llm' && cached?.category === 'Other';
    const isExpiredLlmOther = Boolean(
      isLlmOther &&
      cached?.classification?.classifiedAt &&
      Date.now() - new Date(cached.classification.classifiedAt).getTime() >= LLM_OTHER_RETRY_MS
    );

    if (isInputHashMatch && !isExpiredLlmOther) {
      cacheHits++;
      classifiedRepos.push({
        ...repo,
        category: cached.category,
        classification: cached.classification,
      });
    } else {
      newlyClassified++;

      let category: RepositoryCategory = 'Other';
      let method: ClassificationMethod = 'rule';
      let confidence = 0.85;

      if (ruleOnly) {
        const ruleRes = classifyWithRules(repo);
        if (ruleRes) {
          category = ruleRes.category;
          method = ruleRes.method;
          confidence = ruleRes.confidence;
        } else {
          category = 'Other';
          method = 'fallback';
          confidence = 0.5;
        }
      } else if (llmClassify) {
        const classRes = await llmClassify(repo);
        category = classRes.category;
        method = classRes.method;
        confidence = classRes.confidence;
      } else {
        const ruleRes = classifyWithRules(repo);
        if (ruleRes) {
          category = ruleRes.category;
          method = ruleRes.method;
          confidence = ruleRes.confidence;
        } else {
          category = 'Other';
          method = 'fallback';
          confidence = 0.5;
        }
      }

      const classificationMeta: ClassificationMeta = {
        method,
        confidence,
        classifiedAt: new Date().toISOString(),
        inputHash,
      };

      if (!noCache && method !== 'fallback') {
        cache[repo.fullName] = {
          category,
          classification: classificationMeta,
        };
      }

      classifiedRepos.push({
        ...repo,
        category,
        classification: classificationMeta,
      });
    }

    if (onProgress) {
      onProgress(i + 1, repos.length, repo);
    }
  }

  return {
    repos: classifiedRepos,
    cache,
    cacheHits,
    newlyClassified,
  };
}
