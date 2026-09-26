import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchAllStarredRepos, resolveActiveUsername } from './github.ts';
import { fetchUserStarLists, mergeStarLists } from './star-lists.ts';
import { computeInputHash, loadCache, saveCache, type ClassificationCache } from './cache.ts';
import { classifyRepo, classifyWithRules } from './classifier.ts';
import { applyOverrides, loadOverrides } from './overrides.ts';
import { validateRepos } from './validator.ts';
import { atomicWriteJson } from './storage.ts';
import type { Repository, DatasetMetadata, RepositoryCategory, ClassificationMethod } from '../../src/types/repo.ts';

export interface PipelineLogger {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface PipelineOptions {
  username?: string;
  token?: string;
  geminiKey?: string;
  ruleOnly?: boolean;
  outputPath: string;
  cachePath?: string | null;
  noCache?: boolean;
  seedReposPath?: string | null;
  useOverrides?: boolean;
  overridesPath?: string;
  metadataPath?: string | null;
  checkUnchanged?: boolean;
  logger?: PipelineLogger;
  onPageFetched?: (page: number, count: number) => void;
}

export interface PipelineResult {
  repos: Repository[];
  totalCount: number;
  activeUser?: string;
  cacheHits: number;
  newlyClassified: number;
  outputPath: string;
  unchanged?: boolean;
}

/**
 * Reusable, isolated dataset generation pipeline.
 * Fetches starred repositories, retrieves star lists, classifies using rules and/or LLM,
 * validates against schema, and writes output atomically.
 */
export async function executeDatasetPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const logger: PipelineLogger = options.logger || console;
  const username = options.username?.trim() || undefined;
  const token = options.token?.trim() || undefined;
  const geminiKey = options.geminiKey?.trim() || undefined;
  const ruleOnly = Boolean(options.ruleOnly);
  const outputPath = resolve(options.outputPath);
  const noCache = Boolean(options.noCache);
  const cachePath = noCache ? null : (options.cachePath ? resolve(options.cachePath) : null);
  const useOverrides = Boolean(options.useOverrides);
  const seedReposPath = options.seedReposPath === null ? null : (options.seedReposPath ? resolve(options.seedReposPath) : null);

  // Step 1: Fetch starred repositories from GitHub REST API
  logger.log(`[pipeline] Fetching starred repositories${username ? ` for user "${username}"` : ' (authenticated user)'}...`);
  const fetchedRepos = await fetchAllStarredRepos({
    username,
    token,
    onPageFetched: options.onPageFetched || ((page, count) => {
      logger.log(`  Fetched page ${page} (${count} repositories)`);
    }),
  });

  const activeUser = await resolveActiveUsername({ username, token });
  if (activeUser) {
    logger.log(`[pipeline] Resolved active dataset username: @${activeUser}`);
  }

  // Step 2: Retrieve Star Lists via GitHub GraphQL API where supported
  const starListsMap = await fetchUserStarLists({ token, username: activeUser || username });
  const rawRepos = mergeStarLists(fetchedRepos, starListsMap);

  logger.log(`[pipeline] Successfully fetched ${rawRepos.length} total repositories.`);

  // Step 3: Load classification cache (strictly isolated from Deniz's dataset if seedReposPath is null)
  let cache: ClassificationCache = {};
  if (!noCache && cachePath) {
    cache = loadCache(cachePath, seedReposPath);
    logger.log(`[pipeline] Loaded cache with ${Object.keys(cache).length} entries from ${cachePath}.`);
  }

  // Step 4: Classify repositories (incremental using cache)
  const classifiedRepos: Repository[] = [];
  let cacheHits = 0;
  let newlyClassified = 0;

  for (const repo of rawRepos) {
    const inputHash = computeInputHash(repo);
    const cached = cache[repo.fullName];

    if (cached && cached.classification.inputHash === inputHash) {
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
      } else {
        const classRes = await classifyRepo(repo, geminiKey ? { apiKey: geminiKey } : undefined);
        category = classRes.category;
        method = classRes.method;
        confidence = classRes.confidence;
      }

      const classificationMeta = {
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
  }

  logger.log(`[pipeline] Classification complete. Cache hits: ${cacheHits}, Newly classified: ${newlyClassified}.`);

  // Step 5: Optional overrides (disabled for CLI by default)
  let finalRepos = classifiedRepos;
  if (useOverrides) {
    const overrides = loadOverrides(options.overridesPath);
    finalRepos = applyOverrides(classifiedRepos, overrides);
    logger.log(`[pipeline] Applied ${Object.keys(overrides).length} manual overrides.`);
  }

  // Step 6: Validate generated dataset against standard schema
  logger.log('[pipeline] Validating generated dataset schema...');
  const validation = validateRepos(finalRepos);
  if (!validation.valid) {
    const errorDetails = validation.errors.map(err => `  - ${err.message}`).join('\n');
    throw new Error(`Dataset validation failed with ${validation.errors.length} errors:\n${errorDetails}`);
  }

  // Step 7: Optional check for unchanged data (used by scheduled CI workflow)
  let isUnchanged = false;
  if (options.checkUnchanged && existsSync(outputPath)) {
    try {
      const existingRaw = readFileSync(outputPath, 'utf-8');
      const existingRepos = JSON.parse(existingRaw) as Repository[];
      if (existingRepos.length === finalRepos.length) {
        const isIdentical = finalRepos.every((r, idx) => {
          const ex = existingRepos[idx];
          if (!ex) return false;
          const basePropsMatch =
            ex.id === r.id &&
            ex.category === r.category &&
            ex.stars === r.stars &&
            ex.updatedAt === r.updatedAt;
          const exLists = ex.lists || [];
          const rLists = r.lists || [];
          const listsMatch =
            exLists.length === rLists.length &&
            rLists.every((l, lIdx) => exLists[lIdx] === l);
          return basePropsMatch && listsMatch;
        });
        if (isIdentical) {
          isUnchanged = true;
        }
      }
    } catch {
      isUnchanged = false;
    }
  }

  if (isUnchanged) {
    logger.log('[pipeline] Dataset is unchanged. No write needed.');
  } else {
    // Step 8: Atomic write
    atomicWriteJson(outputPath, finalRepos);
    logger.log(`[pipeline] Atomically saved ${finalRepos.length} validated repositories to ${outputPath}`);

    if (options.metadataPath) {
      const metaPath = resolve(options.metadataPath);
      const newMeta: DatasetMetadata = {
        source: {
          type: 'github-stars',
          ...(activeUser ? { username: activeUser } : {}),
        },
        generatedAt: new Date().toISOString(),
        totalRepos: finalRepos.length,
      };
      atomicWriteJson(metaPath, newMeta);
      logger.log(`[pipeline] Saved dataset metadata to ${metaPath}`);
    }

    if (!noCache && cachePath) {
      saveCache(cache, cachePath);
      logger.log(`[pipeline] Saved cache to ${cachePath}`);
    }
  }

  return {
    repos: finalRepos,
    totalCount: finalRepos.length,
    activeUser,
    cacheHits,
    newlyClassified,
    outputPath,
    unchanged: isUnchanged,
  };
}
