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
 * Loads cache from data/.cache.json and seeds previously successful classifications
 * from data/repos.json (which persists across GitHub Actions runs).
 * Fallback classifications are NEVER included in the cache.
 */
export function loadCache(customPath?: string, seedReposPath?: string | null): ClassificationCache {
  const filePath = customPath || CACHE_PATH;
  let cache: ClassificationCache = {};

  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      cache = JSON.parse(raw);
    } catch (error) {
      console.warn(`[cache] Failed to read cache from ${filePath}, starting fresh:`, error);
      cache = {};
    }
  }

  // Seed previously successful classifications from tracked data/repos.json if available:
  // Only seed when seedReposPath is explicitly provided, or when customPath is omitted (production pipeline).
  const shouldSeed = seedReposPath !== null && (seedReposPath !== undefined || customPath === undefined);
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
            // Seed if not present or if cached entry was a fallback
            if (!cache[repo.fullName] || cache[repo.fullName].classification?.method === 'fallback') {
              cache[repo.fullName] = {
                category: repo.category,
                classification: repo.classification,
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[cache] Warning: Failed to seed cache from ${seedFile}:`, err);
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
