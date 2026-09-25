import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';
import { computeInputHash, loadCache, saveCache } from './lib/cache.ts';
import { classifyRepo } from './lib/classifier.ts';
import type { NormalizedRepo } from './lib/normalize.ts';
import { applyOverrides, loadOverrides } from './lib/overrides.ts';
import { validateRepos } from './lib/validator.ts';
import type { Repository } from '../src/types/repo.ts';

async function main() {
  console.log('[classify] Starting classification process...');
  const rawPath = resolve(process.cwd(), 'data', 'raw-repos.json');
  const targetPath = resolve(process.cwd(), 'data', 'repos.json');

  if (!existsSync(rawPath)) {
    console.error(`[classify] Cannot find ${rawPath}. Run "npm run pipeline:fetch" first.`);
    process.exit(1);
  }

  const rawRepos: NormalizedRepo[] = JSON.parse(readFileSync(rawPath, 'utf-8'));
  const cache = loadCache();
  const overrides = loadOverrides();

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
      const res = await classifyRepo(repo);
      const classification = {
        method: res.method,
        confidence: res.confidence,
        classifiedAt: new Date().toISOString(),
        inputHash,
      };

      cache[repo.fullName] = {
        category: res.category,
        classification,
      };

      classifiedRepos.push({
        ...repo,
        category: res.category,
        classification,
      });
    }
  }

  console.log(`[classify] Finished: ${cacheHits} cache hits, ${newlyClassified} newly classified.`);

  const finalRepos = applyOverrides(classifiedRepos, overrides);
  const validation = validateRepos(finalRepos);

  if (!validation.valid) {
    console.error(`[classify] Validation failed with ${validation.errors.length} errors:`);
    validation.errors.forEach(e => console.error(`  - ${e.message}`));
    process.exit(1);
  }

  writeFileSync(targetPath, JSON.stringify(finalRepos, null, 2), 'utf-8');
  saveCache(cache);
  console.log(`[classify] Saved ${finalRepos.length} validated repositories to ${targetPath}`);
}

main();
