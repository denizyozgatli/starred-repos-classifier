import Fuse, { type IFuseOptions } from 'fuse.js';
import type { Repository } from '../types/repo.ts';

const FUSE_OPTIONS: IFuseOptions<Repository> = {
  keys: [
    { name: 'name', weight: 0.4 },
    { name: 'fullName', weight: 0.3 },
    { name: 'description', weight: 0.15 },
    { name: 'topics', weight: 0.1 },
    { name: 'language', weight: 0.05 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

let cachedFuse: Fuse<Repository> | null = null;
let cachedReposRef: Repository[] | null = null;

export function searchRepositories(repos: Repository[], query: string): Repository[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return repos;
  }

  // Re-index only when repos reference changes
  if (!cachedFuse || cachedReposRef !== repos) {
    cachedFuse = new Fuse(repos, FUSE_OPTIONS);
    cachedReposRef = repos;
  }

  const results = cachedFuse.search(trimmed);
  return results.map(r => r.item);
}
