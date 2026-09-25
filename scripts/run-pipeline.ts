import { existsSync, readFileSync } from 'node:fs';
import 'dotenv/config';
import { computeInputHash, loadCache, saveCache, type ClassificationCache } from './lib/cache.ts';
import { classifyRepo } from './lib/classifier.ts';
import { fetchAllStarredRepos } from './lib/github.ts';
import { applyOverrides, loadOverrides } from './lib/overrides.ts';
import { validateRepos } from './lib/validator.ts';
import { atomicWriteJson, withDatasetSafety, REPOS_PATH, REPOS_BACKUP_PATH } from './lib/storage.ts';
import type { Repository } from '../src/types/repo.ts';

export async function executePipeline(): Promise<void> {
  console.log('=== GitHub Starred Repos Classifier Data Pipeline ===');

  const hasExistingData = existsSync(REPOS_PATH);

  // Step 1: Fetch starred repositories from GitHub
  console.log('[pipeline] Fetching starred repositories from GitHub API...');
  const rawRepos = await fetchAllStarredRepos({
    onPageFetched: (page, count) => {
      console.log(`  Fetched page ${page} (${count} repositories)`);
    },
  });

  console.log(`[pipeline] Successfully fetched ${rawRepos.length} total repositories.`);

  // Step 2: Load classification cache and manual overrides
  const cache: ClassificationCache = loadCache();
  const overrides = loadOverrides();
  console.log(`[pipeline] Loaded cache with ${Object.keys(cache).length} entries and ${Object.keys(overrides).length} manual overrides.`);

  // Step 3: Classify repositories (incremental using cache)
  const classifiedRepos: Repository[] = [];
  let cacheHits = 0;
  let newClassifications = 0;

  for (const repo of rawRepos) {
    const inputHash = computeInputHash(repo);
    const cached = cache[repo.fullName];

    if (cached && cached.classification.inputHash === inputHash) {
      // Reuse cached classification
      cacheHits++;
      classifiedRepos.push({
        ...repo,
        category: cached.category,
        classification: cached.classification,
      });
    } else {
      // Classify via hybrid rule + LLM
      newClassifications++;
      const result = await classifyRepo(repo);
      const classificationMeta = {
        method: result.method,
        confidence: result.confidence,
        classifiedAt: new Date().toISOString(),
        inputHash,
      };

      // Update cache ONLY for successful (non-fallback) classifications
      if (result.method !== 'fallback') {
        cache[repo.fullName] = {
          category: result.category,
          classification: classificationMeta,
        };
      }

      classifiedRepos.push({
        ...repo,
        category: result.category,
        classification: classificationMeta,
      });
    }
  }

  console.log(`[pipeline] Classification complete. Cache hits: ${cacheHits}, Newly classified: ${newClassifications}.`);

  // Step 4: Apply manual overrides
  const finalRepos = applyOverrides(classifiedRepos, overrides);

  // Step 5: Validate generated dataset
  console.log('[pipeline] Validating generated dataset schema...');
  const validation = validateRepos(finalRepos);
  if (!validation.valid) {
    const errorDetails = validation.errors.map(err => `  - ${err.message}`).join('\n');
    throw new Error(`Dataset validation failed with ${validation.errors.length} errors:\n${errorDetails}`);
  }

  // Step 6: Check if data actually changed to avoid unnecessary disk updates
  let hasChanged = true;
  if (hasExistingData) {
    try {
      const existingRaw = readFileSync(REPOS_PATH, 'utf-8');
      const existingRepos = JSON.parse(existingRaw) as Repository[];
      if (existingRepos.length === finalRepos.length) {
        const isIdentical = finalRepos.every((r, idx) => {
          const ex = existingRepos[idx];
          return ex && ex.id === r.id && ex.category === r.category && ex.stars === r.stars && ex.updatedAt === r.updatedAt;
        });
        if (isIdentical) {
          hasChanged = false;
        }
      }
    } catch {
      hasChanged = true;
    }
  }

  if (!hasChanged) {
    console.log('[pipeline] Dataset is unchanged. No write needed.');
  } else {
    // Step 7: Atomic write via temporary file swap
    atomicWriteJson(REPOS_PATH, finalRepos);
    console.log(`[pipeline] Atomically saved ${finalRepos.length} validated repositories to ${REPOS_PATH}`);
    saveCache(cache);
  }

  console.log('[pipeline] Pipeline completed successfully!');
}

export async function runPipeline(): Promise<void> {
  try {
    await withDatasetSafety(REPOS_PATH, REPOS_BACKUP_PATH, () => executePipeline());
  } catch (error) {
    console.error('[pipeline] CRITICAL FAILURE:', error);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('run-pipeline.ts') || process.argv[1]?.endsWith('run-pipeline.js')) {
  runPipeline();
}
