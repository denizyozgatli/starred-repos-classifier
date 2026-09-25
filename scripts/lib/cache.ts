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
 * Loads cache from data/.cache.json.
 */
export function loadCache(customPath?: string): ClassificationCache {
  const filePath = customPath || CACHE_PATH;
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[cache] Failed to read cache from ${filePath}, starting fresh:`, error);
    return {};
  }
}

/**
 * Saves cache to data/.cache.json.
 */
export function saveCache(cache: ClassificationCache, customPath?: string): void {
  const filePath = customPath || CACHE_PATH;
  try {
    writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[cache] Failed to write cache to ${filePath}:`, error);
  }
}
