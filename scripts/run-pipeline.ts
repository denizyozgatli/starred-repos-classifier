import { resolve } from 'node:path';
import 'dotenv/config';
import { parseUsernameFromArgs } from './lib/github.ts';
import { executeDatasetPipeline } from './lib/pipeline.ts';
import { withDatasetSafety, REPOS_PATH, REPOS_BACKUP_PATH, METADATA_PATH } from './lib/storage.ts';

export async function executePipeline(): Promise<void> {
  console.log('=== GitHub Starred Repos Classifier Data Pipeline ===');

  await executeDatasetPipeline({
    username: parseUsernameFromArgs(),
    token: process.env.GITHUB_TOKEN,
    geminiKey: process.env.GEMINI_API_KEY,
    outputPath: REPOS_PATH,
    cachePath: resolve(process.cwd(), 'data', '.cache.json'),
    useOverrides: true,
    overridesPath: resolve(process.cwd(), 'data', 'overrides.json'),
    seedReposPath: REPOS_PATH,
    metadataPath: METADATA_PATH,
    checkUnchanged: true,
  });

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
