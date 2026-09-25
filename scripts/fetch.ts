import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';
import { fetchAllStarredRepos } from './lib/github.ts';

async function main() {
  console.log('[fetch] Starting GitHub stars fetch...');
  try {
    const repos = await fetchAllStarredRepos({
      onPageFetched: (page, count) => console.log(`  Page ${page}: ${count} repos`),
    });

    const target = resolve(process.cwd(), 'data', 'raw-repos.json');
    writeFileSync(target, JSON.stringify(repos, null, 2), 'utf-8');
    console.log(`[fetch] Successfully fetched ${repos.length} repos to ${target}`);
  } catch (error) {
    console.error('[fetch] Failed to fetch starred repositories:', error);
    process.exit(1);
  }
}

main();
