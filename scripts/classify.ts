import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';
import { loadCache, saveCache } from './lib/cache.ts';
import { classifyRepo } from './lib/classifier.ts';
import type { NormalizedRepo } from './lib/normalize.ts';
import { applyOverrides, loadOverrides } from './lib/overrides.ts';
import { validateRepos } from './lib/validator.ts';
import { atomicWriteJson, withDatasetSafety, REPOS_PATH, REPOS_BACKUP_PATH } from './lib/storage.ts';
import type { Repository } from '../src/types/repo.ts';
import { classifyRepos } from '../src/core/classify-repos.ts';

export async function runClassification(
  rawPath: string = resolve(process.cwd(), 'data', 'raw-repos.json'),
  targetPath: string = REPOS_PATH
): Promise<Repository[]> {
  console.log('[classify] Starting classification process...');

  if (!existsSync(rawPath)) {
    throw new Error(`Cannot find ${rawPath}. Run "npm run pipeline:fetch" first.`);
  }

  const rawRepos: NormalizedRepo[] = JSON.parse(readFileSync(rawPath, 'utf-8'));
  const cache = loadCache();
  const overrides = loadOverrides();

  const {
    repos: classifiedRepos,
    cache: updatedCache,
    cacheHits,
    newlyClassified,
  } = await classifyRepos(rawRepos, {
    cache,
    llmClassify: (repo) => classifyRepo(repo),
  });

  console.log(`[classify] Finished: ${cacheHits} cache hits, ${newlyClassified} newly classified.`);

  const finalRepos = applyOverrides(classifiedRepos, overrides);
  const validation = validateRepos(finalRepos);

  if (!validation.valid) {
    const errorDetails = validation.errors.map(e => `  - ${e.message}`).join('\n');
    throw new Error(`Validation failed with ${validation.errors.length} errors:\n${errorDetails}`);
  }

  atomicWriteJson(targetPath, finalRepos);
  saveCache(updatedCache);
  console.log(`[classify] Saved ${finalRepos.length} validated repositories to ${targetPath}`);
  return finalRepos;
}

export async function main(): Promise<void> {
  try {
    await withDatasetSafety(REPOS_PATH, REPOS_BACKUP_PATH, () => runClassification());
  } catch (err) {
    console.error('[classify] Fatal error during classification:', err);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('classify.ts') || process.argv[1]?.endsWith('classify.js')) {
  main();
}
