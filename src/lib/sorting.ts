import type { Repository } from '../types/repo.ts';

export type SortOption = 'stars' | 'updated' | 'relevance' | 'name';

export function sortRepositories(repos: Repository[], sortBy: SortOption): Repository[] {
  // If relevance, preserve current search or source order
  if (sortBy === 'relevance') {
    return [...repos];
  }

  const sorted = [...repos];

  switch (sortBy) {
    case 'stars':
      return sorted.sort((a, b) => b.stars - a.stars);
    case 'updated':
      return sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    default:
      return sorted;
  }
}
