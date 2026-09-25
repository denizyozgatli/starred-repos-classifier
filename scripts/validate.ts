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
}

main();
