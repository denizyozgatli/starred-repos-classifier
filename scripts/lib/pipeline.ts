import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchAllStarredRepos, getAuthenticatedUser } from './github.ts';
import { fetchUserStarLists, mergeStarLists } from './star-lists.ts';
import { loadCache, saveCache, type ClassificationCache } from './cache.ts';
import { classifyRepo } from './classifier.ts';
import { applyOverrides, loadOverrides } from './overrides.ts';
import { validateRepos } from './validator.ts';
import { atomicWriteJson } from './storage.ts';
import type { Repository, DatasetMetadata } from '../../src/types/repo.ts';
import { classifyRepos } from '../../src/core/classify-repos.ts';
import { buildDatasetEnvelope, extractRepos } from '../../src/core/dataset.ts';

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

  let ownerLogin: string | undefined;
  if (token) {
    try {
      const authUser = await getAuthenticatedUser(token);
      ownerLogin = authUser.login;
    } catch {
      // Non-fatal if /user fails
    }
  }

  const isViewer = Boolean(token && (!username || (ownerLogin && username.toLowerCase() === ownerLogin.toLowerCase())));
  const activeUser = username || ownerLogin;
  if (activeUser) {
    logger.log(`[pipeline] Resolved active dataset username: @${activeUser}`);
  }

  // Step 1: Fetch starred repositories from GitHub REST API
  logger.log(`[pipeline] Fetching starred repositories${isViewer ? ' (authenticated user)' : ` for user "${username}"`}...`);
  const fetchedRepos = await fetchAllStarredRepos({
    username,
    token,
    tokenOwnerLogin: ownerLogin,
    onPageFetched: options.onPageFetched || ((page, count) => {
      logger.log(`  Fetched page ${page} (${count} repositories)`);
    }),
  });

  // Step 2: Retrieve Star Lists via GitHub GraphQL API where supported
  const starListsMap = await fetchUserStarLists({
    token,
    username: isViewer ? undefined : (username || activeUser),
    isViewer,
    logger,
  });
  const rawRepos = mergeStarLists(fetchedRepos, starListsMap);

  logger.log(`[pipeline] Successfully fetched ${rawRepos.length} total repositories.`);

  // Step 3: Load classification cache (strictly isolated from Deniz's dataset if seedReposPath is null)
  let cache: ClassificationCache = {};
  if (!noCache && cachePath) {
    cache = loadCache(cachePath, seedReposPath);
    logger.log(`[pipeline] Loaded cache with ${Object.keys(cache).length} entries from ${cachePath}.`);
  }

  // Step 4: Classify repositories (incremental using shared core classifyRepos)
  const {
    repos: classifiedRepos,
    cache: updatedCache,
    cacheHits,
    newlyClassified,
  } = await classifyRepos(rawRepos, {
    cache,
    ruleOnly,
    noCache,
    llmClassify: !ruleOnly
      ? (repo) => classifyRepo(repo, geminiKey ? { apiKey: geminiKey } : undefined)
      : undefined,
  });
  cache = updatedCache;

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
      const parsed = JSON.parse(existingRaw);
      const existingRepos = extractRepos(parsed);
      if (existingRepos && existingRepos.length === finalRepos.length) {
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
          if (Array.isArray(parsed)) {
            const envelope = buildDatasetEnvelope(finalRepos, {
              username: activeUser,
            });
            atomicWriteJson(outputPath, envelope);
            logger.log('[pipeline] Upgraded legacy dataset file to envelope format');
          }
        }
      }
    } catch {
      isUnchanged = false;
    }
  }

  if (isUnchanged) {
    logger.log('[pipeline] Dataset is unchanged. No write needed.');
  } else {
    // Step 8: Atomic write (write versioned DatasetEnvelope)
    const envelope = buildDatasetEnvelope(finalRepos, {
      username: activeUser,
    });
    atomicWriteJson(outputPath, envelope);
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
