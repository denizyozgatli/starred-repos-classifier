import type { Repository, RepositoryCategory } from '../types/repo.ts';

export interface FilterOption<T = string> {
  value: T;
  label: string;
  count: number;
}

export interface DynamicFilterOptions {
  categories: FilterOption<RepositoryCategory>[];
  languages: FilterOption<string>[];
}

/**
 * Extracts dynamic categories and languages from dataset with their item counts.
 * No hardcoded lists are used.
 */
export function extractFilterOptions(repos: Repository[]): DynamicFilterOptions {
  const categoryCounts = new Map<RepositoryCategory, number>();
  const languageCounts = new Map<string, number>();

  for (const repo of repos) {
    // Categories
    categoryCounts.set(repo.category, (categoryCounts.get(repo.category) || 0) + 1);

    // Languages
    if (repo.language) {
      languageCounts.set(repo.language, (languageCounts.get(repo.language) || 0) + 1);
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

  return { categories, languages };
}

/**
 * Filters repositories by selected categories and selected languages.
 * Supports multi-selection for both.
 */
export function filterRepositories(
  repos: Repository[],
  selectedCategories: RepositoryCategory[],
  selectedLanguages: string[]
): Repository[] {
  if (selectedCategories.length === 0 && selectedLanguages.length === 0) {
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

    return matchesCategory && matchesLanguage;
  });
}
