import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';
import { computeInputHash, loadCache, saveCache, type ClassificationCache } from './lib/cache.ts';
import { classifyRepo } from './lib/classifier.ts';
import { fetchAllStarredRepos } from './lib/github.ts';
import { applyOverrides, loadOverrides } from './lib/overrides.ts';
import { validateRepos } from './lib/validator.ts';
import type { Repository } from '../src/types/repo.ts';

const REPOS_FILE = resolve(process.cwd(), 'data', 'repos.json');
const BACKUP_FILE = resolve(process.cwd(), 'data', 'repos.backup.json');

export async function runPipeline(): Promise<void> {
  console.log('=== GitHub Starred Repos Classifier Data Pipeline ===');

  // Step 1: Backup existing repos.json if it exists
  const hasExistingData = existsSync(REPOS_FILE);
  if (hasExistingData) {
    try {
      copyFileSync(REPOS_FILE, BACKUP_FILE);
      console.log(`[pipeline] Backed up existing dataset to ${BACKUP_FILE}`);
    } catch (err) {
      console.warn('[pipeline] Warning: Failed to create backup file:', err);
    }
  }

  try {
    // Step 2: Fetch starred repositories from GitHub
    console.log('[pipeline] Fetching starred repositories from GitHub API...');
    const rawRepos = await fetchAllStarredRepos({
      onPageFetched: (page, count) => {
        console.log(`  Fetched page ${page} (${count} repositories)`);
      },
    });

    console.log(`[pipeline] Successfully fetched ${rawRepos.length} total repositories.`);

    // Step 3: Load classification cache and manual overrides
    const cache: ClassificationCache = loadCache();
    const overrides = loadOverrides();
    console.log(`[pipeline] Loaded cache with ${Object.keys(cache).length} entries and ${Object.keys(overrides).length} manual overrides.`);

    // Step 4: Classify repositories (incremental using cache)
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

        // Update cache
        cache[repo.fullName] = {
          category: result.category,
          classification: classificationMeta,
        };

        classifiedRepos.push({
          ...repo,
          category: result.category,
          classification: classificationMeta,
        });
      }
    }

    console.log(`[pipeline] Classification complete. Cache hits: ${cacheHits}, Newly classified: ${newClassifications}.`);

    // Step 5: Apply manual overrides
    const finalRepos = applyOverrides(classifiedRepos, overrides);

    // Step 6: Validate generated dataset
    console.log('[pipeline] Validating generated dataset schema...');
    const validation = validateRepos(finalRepos);
    if (!validation.valid) {
      console.error(`[pipeline] CRITICAL: Generated dataset failed validation with ${validation.errors.length} errors.`);
      validation.errors.forEach(err => console.error(`  - ${err.message}`));
      throw new Error('Dataset validation failed. Refusing to publish invalid data.');
    }

    // Step 7: Check if data actually changed to avoid unnecessary updates
    let hasChanged = true;
    if (hasExistingData) {
      try {
        const existingRaw = readFileSync(REPOS_FILE, 'utf-8');
        const existingRepos = JSON.parse(existingRaw) as Repository[];
        // Compare essential content (ids, categories, fullNames)
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
      console.log('[pipeline] Dataset is unchanged. No commit/update needed.');
    } else {
      // Step 8: Atomic publish
      writeFileSync(REPOS_FILE, JSON.stringify(finalRepos, null, 2), 'utf-8');
      console.log(`[pipeline] Saved ${finalRepos.length} validated repositories to ${REPOS_FILE}`);
      saveCache(cache);
    }

    console.log('[pipeline] Pipeline completed successfully!');
  } catch (error) {
    console.error('[pipeline] CRITICAL FAILURE:', error);
    if (hasExistingData && existsSync(BACKUP_FILE)) {
      console.log('[pipeline] Restoring previous valid dataset from backup...');
      try {
        copyFileSync(BACKUP_FILE, REPOS_FILE);
        console.log('[pipeline] Successfully restored previous valid dataset.');
      } catch (restoreErr) {
        console.error('[pipeline] Failed to restore backup:', restoreErr);
      }
    }
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('run-pipeline.ts') || process.argv[1]?.endsWith('run-pipeline.js')) {
  runPipeline();
}
