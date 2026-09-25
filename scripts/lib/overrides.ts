import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALLOWED_CATEGORIES, type ManualOverrides, type Repository } from '../../src/types/repo.ts';

const OVERRIDES_PATH = resolve(process.cwd(), 'data', 'overrides.json');

/**
 * Loads manual overrides from data/overrides.json.
 */
export function loadOverrides(customPath?: string): ManualOverrides {
  const filePath = customPath || OVERRIDES_PATH;
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validOverrides: ManualOverrides = {};

    for (const [key, val] of Object.entries(parsed)) {
      if (val && typeof val === 'object' && 'category' in val) {
        const cat = (val as { category: unknown }).category;
        if (typeof cat === 'string' && ALLOWED_CATEGORIES.includes(cat as any)) {
          validOverrides[key] = { category: cat as any };
        } else {
          console.warn(`[overrides] Ignoring invalid category "${cat}" for repo "${key}"`);
        }
      }
    }
    return validOverrides;
  } catch (error) {
    console.error(`[overrides] Failed to load overrides from ${filePath}:`, error);
    return {};
  }
}

/**
 * Applies manual overrides to a list of repositories.
 * Manual overrides take highest precedence over rule and LLM classifications.
 */
export function applyOverrides(repos: Repository[], overrides: ManualOverrides): Repository[] {
  return repos.map(repo => {
    const override = overrides[repo.fullName];
    if (override) {
      return {
        ...repo,
        category: override.category,
        classification: {
          ...repo.classification,
          method: 'manual',
          confidence: 1.0,
          classifiedAt: repo.classification.classifiedAt,
        },
      };
    }
    return repo;
  });
}
