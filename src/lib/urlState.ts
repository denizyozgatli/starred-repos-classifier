import type { RepositoryCategory } from '../types/repo.ts';
import type { SortOption } from './sorting.ts';

export interface DashboardState {
  query: string;
  categories: RepositoryCategory[];
  languages: string[];
  sortBy: SortOption;
  list: string | null;
}

/**
 * Parses dashboard state from URL search parameters.
 */
export function readStateFromUrl(): DashboardState {
  if (typeof window === 'undefined') {
    return { query: '', categories: [], languages: [], sortBy: 'relevance', list: null };
  }

  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';

  const catParam = params.get('category');
  const categories: RepositoryCategory[] = catParam
    ? (catParam.split(',').filter(Boolean) as RepositoryCategory[])
    : [];

  const langParam = params.get('language');
  const languages: string[] = langParam ? langParam.split(',').filter(Boolean) : [];

  const sortParam = params.get('sort') as SortOption | null;
  const sortBy: SortOption =
    sortParam && ['stars', 'updated', 'relevance', 'name'].includes(sortParam)
      ? sortParam
      : 'relevance';

  const list = params.get('list')?.trim() || null;

  return { query, categories, languages, sortBy, list };
}

/**
 * Serializes dashboard state into URL search string.
 */
export function stateToQueryString(state: DashboardState): string {
  const params = new URLSearchParams();

  if (state.query.trim()) {
    params.set('q', state.query.trim());
  }

  if (state.categories.length > 0) {
    params.set('category', state.categories.join(','));
  }

  if (state.languages.length > 0) {
    params.set('language', state.languages.join(','));
  }

  if (state.sortBy !== 'relevance') {
    params.set('sort', state.sortBy);
  }

  if (state.list && state.list.trim()) {
    params.set('list', state.list.trim());
  }

  const str = params.toString();
  return str ? `?${str}` : '';
}

/**
 * Synchronizes dashboard state to the browser URL using history.replaceState or pushState.
 */
export function syncStateToUrl(state: DashboardState, push = false): void {
  if (typeof window === 'undefined') return;

  const currentSearch = window.location.search;
  const newSearch = stateToQueryString(state);

  if (currentSearch === newSearch) return;

  const newUrl = `${window.location.pathname}${newSearch}${window.location.hash}`;
  if (push) {
    window.history.pushState(null, '', newUrl);
  } else {
    window.history.replaceState(null, '', newUrl);
  }
}
