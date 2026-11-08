import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClassificationMeta, RepositoryCategory } from '../../src/types/repo.ts';

export interface CacheEntry {
  category: RepositoryCategory;
  classification: ClassificationMeta;
}

export type ClassificationCache = Record<string, CacheEntry>;

const CACHE_PATH = resolve(process.cwd(), 'data', '.cache.json');
const DEFAULT_REPOS_PATH = resolve(process.cwd(), 'data', 'repos.json');

/**
 * Computes a deterministic SHA-256 hash based on repository name, description, topics, and language.
 */
export function computeInputHash(repo: {
  fullName: string;
  description: string | null;
  topics: string[];
  language: string | null;
}): string {
  const topicsArray = Array.isArray(repo.topics) ? repo.topics : [];
  const normalizedTopics = [...topicsArray].map(t => String(t).toLowerCase().trim()).sort().join(',');
  const payload = [
    repo.fullName.toLowerCase().trim(),
    (repo.description || '').trim(),
    normalizedTopics,
    (repo.language || '').toLowerCase().trim(),
  ].join('||');

  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Loads classification cache.
 * Authoritative existing dataset classifications (when a seed dataset is provided) take precedence over
 * transient local cache entries in data/.cache.json.
 * data/.cache.json is only used to backfill entries not present in the authoritative dataset.
 * Fallback classifications are NEVER included in the cache.
 */
export function loadCache(customPath?: string, seedReposPath?: string | null): ClassificationCache {
  const filePath = customPath || CACHE_PATH;
  const cache: ClassificationCache = {};

  // 1. Seed authoritative classifications from seed dataset if provided and exists:
  const shouldSeed = seedReposPath !== null && (seedReposPath !== undefined || (customPath === undefined && existsSync(DEFAULT_REPOS_PATH)));
  const seedFile = shouldSeed ? (seedReposPath || DEFAULT_REPOS_PATH) : null;
  if (seedFile && existsSync(seedFile)) {
    try {
      const raw = readFileSync(seedFile, 'utf-8');
      const repos = JSON.parse(raw);
      if (Array.isArray(repos)) {
        for (const repo of repos) {
          if (
            repo &&
            repo.fullName &&
            repo.category &&
            repo.classification &&
            repo.classification.method &&
            repo.classification.method !== 'fallback' &&
            repo.classification.inputHash
          ) {
            cache[repo.fullName] = {
              category: repo.category,
              classification: repo.classification,
            };
          }
        }
      }
    } catch (err) {
      console.warn(`[cache] Warning: Failed to seed cache from ${seedFile}:`, err);
    }
  }

  // 2. Backfill with data/.cache.json for repositories NOT already seeded from the authoritative dataset
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const diskCache = JSON.parse(raw);
      if (diskCache && typeof diskCache === 'object') {
        for (const [key, entry] of Object.entries(diskCache as Record<string, CacheEntry>)) {
          if (
            entry &&
            entry.category &&
            entry.classification &&
            entry.classification.method &&
            entry.classification.method !== 'fallback' &&
            entry.classification.inputHash
          ) {
            // Only backfill if NOT already seeded by the authoritative dataset
            if (!cache[key]) {
              cache[key] = entry;
            }
          }
        }
      }
    } catch (error) {
      console.warn(`[cache] Failed to read cache from ${filePath}, starting fresh:`, error);
    }
  }

  // Strictly enforce that fallback classifications are never present in the cache
  for (const key of Object.keys(cache)) {
    if (cache[key]?.classification?.method === 'fallback') {
      delete cache[key];
    }
  }

  return cache;
}

/**
 * Saves cache to data/.cache.json.
 * Excludes any fallback classifications from disk persistence.
 */
export function saveCache(cache: ClassificationCache, customPath?: string): void {
  const filePath = customPath || CACHE_PATH;
  const cleanCache: ClassificationCache = {};
  for (const [key, entry] of Object.entries(cache)) {
    if (entry && entry.classification && entry.classification.method !== 'fallback') {
      cleanCache[key] = entry;
    }
  }

  try {
    writeFileSync(filePath, JSON.stringify(cleanCache, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[cache] Failed to write cache to ${filePath}:`, error);
  }
}
