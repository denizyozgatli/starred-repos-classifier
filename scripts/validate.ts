import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRepos } from './lib/validator.ts';

function main() {
  const customPath = process.argv[2];
  const filePath = customPath ? resolve(process.cwd(), customPath) : resolve(process.cwd(), 'data', 'repos.json');
  console.log(`[validate] Checking dataset at ${filePath}...`);

  if (!existsSync(filePath)) {
    if (customPath) {
      console.error(`[validate] ERROR: Specified dataset file ${filePath} does not exist.`);
      process.exit(1);
    }
    console.log(`[validate] Notice: No default dataset found at ${filePath}.`);
    console.log('[validate] Skipping validation. To validate a dataset, provide its path: npm run pipeline:validate -- <path-to-json>');
    process.exit(0);
  }

  let repos: unknown;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    repos = JSON.parse(raw);
  } catch (error) {
    console.error(`[validate] ERROR: Failed to parse JSON from ${filePath}:`, error);
    process.exit(1);
  }

  const result = validateRepos(repos);
  if (!result.valid) {
    console.error(`[validate] ERROR: Dataset failed validation with ${result.errors.length} error(s):`);
    result.errors.forEach((err, i) => {
      console.error(`  ${i + 1}. [${err.repoFullName || 'General'}${err.field ? ` -> ${err.field}` : ''}] ${err.message}`);
    });
    process.exit(1);
  }

  const count = Array.isArray(repos) ? repos.length : (repos as { repos?: unknown[] }).repos?.length ?? 0;
  console.log(`[validate] SUCCESS: Dataset contains ${count} valid repositories.`);

  const metaPath = resolve(process.cwd(), 'data', 'metadata.json');
  if (existsSync(metaPath)) {
    try {
      const metaRaw = readFileSync(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      if (meta?.source?.type === 'github-stars') {
        const userStr = meta.source.username ? ` (@${meta.source.username})` : '';
        console.log(`[validate] Metadata verified: source=github-stars${userStr}`);
      }
    } catch (e) {
      console.warn('[validate] Warning: Failed to parse metadata.json:', e);
    }
  }
}

main();
