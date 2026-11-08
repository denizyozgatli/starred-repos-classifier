import type { Repository, RepositoryCategory } from '../types/repo.ts';

export interface FilterOption<T = string> {
  value: T;
  label: string;
  count: number;
}

export interface DynamicFilterOptions {
  categories: FilterOption<RepositoryCategory>[];
  languages: FilterOption<string>[];
  lists: FilterOption<string>[];
}

/**
 * Extracts dynamic categories, languages, and star lists from dataset with their item counts.
 * No hardcoded lists are used.
 */
export function extractFilterOptions(repos: Repository[]): DynamicFilterOptions {
  const categoryCounts = new Map<RepositoryCategory, number>();
  const languageCounts = new Map<string, number>();
  const listCounts = new Map<string, number>();

  for (const repo of repos) {
    // Categories
    categoryCounts.set(repo.category, (categoryCounts.get(repo.category) || 0) + 1);

    // Languages
    if (repo.language) {
      languageCounts.set(repo.language, (languageCounts.get(repo.language) || 0) + 1);
    }

    // Star Lists
    if (Array.isArray(repo.lists)) {
      for (const listName of repo.lists) {
        if (listName && listName.trim()) {
          const trimmed = listName.trim();
          listCounts.set(trimmed, (listCounts.get(trimmed) || 0) + 1);
        }
      }
    }
  }

  // Sort categories by count descending, then alphabetically
  const categories = Array.from(categoryCounts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // Sort languages by count descending, then alphabetically
  const languages = Array.from(languageCounts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // Sort lists by count descending, then alphabetically
  const lists = Array.from(listCounts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { categories, languages, lists };
}

/**
 * Filters repositories by selected categories, selected languages, and optional star list.
 * Categories and languages support multi-selection. Star List is single-select or null ("All Lists").
 */
export function filterRepositories(
  repos: Repository[],
  selectedCategories: RepositoryCategory[],
  selectedLanguages: string[],
  selectedList?: string | null
): Repository[] {
  if (selectedCategories.length === 0 && selectedLanguages.length === 0 && !selectedList) {
    return repos;
  }

  const categorySet = new Set(selectedCategories);
  const languageSet = new Set(selectedLanguages);

  return repos.filter(repo => {
    // Category match: if no categories selected, passes; otherwise must match one of selected
    const matchesCategory =
      selectedCategories.length === 0 || categorySet.has(repo.category);

    // Language match: if no languages selected, passes; otherwise repo.language must match one
    const matchesLanguage =
      selectedLanguages.length === 0 || (repo.language !== null && languageSet.has(repo.language));

    // Star List match: if selectedList specified, repo must have repo.lists containing selectedList
    const matchesList =
      !selectedList ||
      (Array.isArray(repo.lists) && repo.lists.includes(selectedList));

    return matchesCategory && matchesLanguage && matchesList;
  });
}

export interface ContextualFilterParams {
  selectedCategories?: RepositoryCategory[];
  selectedLanguages?: string[];
  selectedList?: string | null;
}

/**
 * Computes context-aware dynamic filter options for faceted navigation.
 * For each facet (category, star list, language), peer active filters are applied,
 * excluding the facet itself to avoid circular filtering while ensuring counts and
 * available options accurately reflect the active context.
 */
export function computeContextualFilterOptions(
  repos: Repository[],
  params: ContextualFilterParams
): DynamicFilterOptions {
  const selectedCategories = params.selectedCategories || [];
  const selectedLanguages = params.selectedLanguages || [];
  const selectedList = params.selectedList ?? null;

  if (selectedCategories.length === 0 && selectedLanguages.length === 0 && !selectedList) {
    return extractFilterOptions(repos);
  }

  // 1. For Category facet: apply active Star List and Languages (exclude Category)
  const reposForCategories = filterRepositories(
    repos,
    [],
    selectedLanguages,
    selectedList
  );

  // 2. For Star List facet: apply active Categories and Languages (exclude Star List)
  const reposForLists = filterRepositories(
    repos,
    selectedCategories,
    selectedLanguages,
    null
  );

  // 3. For Language facet: apply active Categories and Star List (exclude Languages)
  const reposForLanguages = filterRepositories(
    repos,
    selectedCategories,
    [],
    selectedList
  );

  return {
    categories: extractFilterOptions(reposForCategories).categories,
    lists: extractFilterOptions(reposForLists).lists,
    languages: extractFilterOptions(reposForLanguages).languages,
  };
}
