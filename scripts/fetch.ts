import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';
import { fetchAllStarredRepos, parseUsernameFromArgs, resolveActiveUsername } from './lib/github.ts';
import { fetchUserStarLists, mergeStarLists } from './lib/star-lists.ts';

async function main() {
  const username = parseUsernameFromArgs();
  console.log(`[fetch] Starting GitHub stars fetch${username ? ` for user "${username}"` : ' (authenticated user)'}...`);

  try {
    const rawRepos = await fetchAllStarredRepos({
      username,
      onPageFetched: (page, count) => console.log(`  Page ${page}: ${count} repos`),
    });

    const activeUser = await resolveActiveUsername({ username });
    if (activeUser) {
      console.log(`[fetch] Resolved active dataset username: @${activeUser}`);
    }

    // Retrieve Star Lists where possible
    const token = process.env.GITHUB_TOKEN;
    const starListsMap = await fetchUserStarLists({ token, username: activeUser || username });
    const repos = mergeStarLists(rawRepos, starListsMap);

    const target = resolve(process.cwd(), 'data', 'raw-repos.json');
    writeFileSync(target, JSON.stringify(repos, null, 2), 'utf-8');
    console.log(`[fetch] Successfully fetched ${repos.length} repos to ${target}`);
  } catch (error) {
    console.error('[fetch] Failed to fetch starred repositories:', error);
    process.exit(1);
  }
}

main();
