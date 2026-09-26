import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRepos } from './lib/validator.ts';

function main() {
  const filePath = resolve(process.cwd(), 'data', 'repos.json');
  console.log(`[validate] Checking dataset at ${filePath}...`);

  if (!existsSync(filePath)) {
    console.error(`[validate] ERROR: ${filePath} does not exist.`);
    process.exit(1);
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

  console.log(`[validate] SUCCESS: Dataset contains ${(repos as unknown[]).length} valid repositories.`);

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
