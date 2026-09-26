import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Repository, RepositoryCategory } from './types/repo.ts';
import type { DatasetValidationResult } from './lib/datasetValidation.ts';
import { computeContextualFilterOptions, filterRepositories } from './lib/filters.ts';
import { searchRepositories } from './lib/search.ts';
import { sortRepositories, type SortOption } from './lib/sorting.ts';
import { readStateFromUrl, syncStateToUrl } from './lib/urlState.ts';
import { Header } from './components/Header.tsx';
import { ImportModal } from './components/ImportModal.tsx';
import { SearchBar } from './components/SearchBar.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { SortSelector } from './components/SortSelector.tsx';
import { RepoGrid } from './components/RepoGrid.tsx';
import { EmptyState } from './components/EmptyState.tsx';

const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env;

export default function App() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [importedMetadata, setImportedMetadata] = useState<DatasetValidationResult['metadata'] | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const datasetOwner = metaEnv?.VITE_GITHUB_USERNAME?.trim() || importedMetadata?.username;

  // Initialize state from URL params
  const [query, setQuery] = useState<string>('');
  const [selectedCategories, setSelectedCategories] = useState<RepositoryCategory[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');

  // Load initial URL state on mount
  useEffect(() => {
    const initialState = readStateFromUrl();
    setQuery(initialState.query);
    setSelectedCategories(initialState.categories);
    setSelectedLanguages(initialState.languages);
    setSelectedList(initialState.list);
    setSortBy(initialState.sortBy);

    // Listen to popstate for browser Back/Forward
    const handlePopState = () => {
      const state = readStateFromUrl();
      setQuery(state.query);
      setSelectedCategories(state.categories);
      setSelectedLanguages(state.languages);
      setSelectedList(state.list);
      setSortBy(state.sortBy);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Synchronize state changes to URL
  useEffect(() => {
    syncStateToUrl({
      query,
      categories: selectedCategories,
      languages: selectedLanguages,
      list: selectedList,
      sortBy,
    });
  }, [query, selectedCategories, selectedLanguages, selectedList, sortBy]);

  // 1. Search base repositories (returns repos directly if query is empty)
  const searchedRepos = useMemo(() => {
    return searchRepositories(repos, query);
  }, [repos, query]);

  // 2. Extract contextual dynamic filter options (context-aware facets)
  const filterOptions = useMemo(() => {
    return computeContextualFilterOptions(searchedRepos, {
      selectedCategories,
      selectedLanguages,
      selectedList,
    });
  }, [searchedRepos, selectedCategories, selectedLanguages, selectedList]);

  // 3. Client-side filter and sort pipeline
  const filteredAndSortedRepos = useMemo(() => {
    const filtered = filterRepositories(searchedRepos, selectedCategories, selectedLanguages, selectedList);
    return sortRepositories(filtered, sortBy);
  }, [searchedRepos, selectedCategories, selectedLanguages, selectedList, sortBy]);

  // Filter toggle handlers
  const handleToggleCategory = useCallback((category: RepositoryCategory) => {
    setSelectedCategories(prev =>
      prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]
    );
  }, []);

  const handleToggleLanguage = useCallback((language: string) => {
    setSelectedLanguages(prev =>
      prev.includes(language) ? prev.filter(l => l !== language) : [...prev, language]
    );
  }, []);

  const handleResetFilters = useCallback(() => {
    setQuery('');
    setSelectedCategories([]);
    setSelectedLanguages([]);
    setSelectedList(null);
    setSortBy('relevance');
  }, []);

  const isImported = importedFileName !== null;

  const handleImport = useCallback(
    (newRepos: Repository[], fileName: string, metadata?: DatasetValidationResult['metadata']) => {
      setRepos(newRepos);
      setImportedFileName(fileName);
      setImportedMetadata(metadata || null);
      setError(null);
      setQuery('');
      setSelectedCategories([]);
      setSelectedLanguages([]);
      setSelectedList(null);
      setSortBy('relevance');
    },
    []
  );

  const handleResetToDefault = useCallback(() => {
    setRepos([]);
    setImportedFileName(null);
    setImportedMetadata(null);
    setError(null);
    setQuery('');
    setSelectedCategories([]);
    setSelectedLanguages([]);
    setSelectedList(null);
    setSortBy('relevance');
  }, []);

  const hasActiveFilters = selectedCategories.length > 0 || selectedLanguages.length > 0 || Boolean(selectedList);

  const exportFilterContext = useMemo(() => ({
    isFiltered: hasActiveFilters || query.trim().length > 0,
    query,
    categories: selectedCategories,
    languages: selectedLanguages,
    list: selectedList,
    sortBy,
    totalCount: repos.length,
  }), [hasActiveFilters, query, selectedCategories, selectedLanguages, selectedList, sortBy, repos.length]);

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] flex flex-col font-sans selection:bg-[#1f6feb] selection:text-white">
      <Header
        totalCount={repos.length}
        filteredCount={filteredAndSortedRepos.length}
        datasetOwner={datasetOwner}
        isImported={isImported}
        importedFileName={importedFileName ?? undefined}
        onOpenImport={() => setIsImportModalOpen(true)}
        onResetToDefault={isImported ? handleResetToDefault : undefined}
        repos={repos}
        filteredRepos={filteredAndSortedRepos}
        filterContext={exportFilterContext}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-3.5 sm:px-8 py-4 sm:py-6 space-y-3.5 sm:space-y-4">
        {/* Controls: Search & Sort Bar */}
        <section aria-label="Search and Sorting Controls" className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <div className="flex-1">
            <SearchBar
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
            />
          </div>
          <div className="shrink-0 flex items-center justify-end">
            <SortSelector value={sortBy} onChange={setSortBy} />
          </div>
        </section>

        {/* Dynamic Filters */}
        <section aria-label="Filter Controls" className="bg-[#161b22]/70 border border-[#30363d] rounded-xl p-3 sm:p-3.5 shadow-xs">
          <FilterBar
            filterOptions={filterOptions}
            selectedCategories={selectedCategories}
            selectedLanguages={selectedLanguages}
            selectedList={selectedList}
            onToggleCategory={handleToggleCategory}
            onToggleLanguage={handleToggleLanguage}
            onSelectList={setSelectedList}
            onClearAll={handleResetFilters}
          />
        </section>

        {/* Main Content Area */}
        <section aria-label="Repositories" className="min-h-[300px]">
          {error ? (
            <EmptyState type="error" message={error} onReset={() => setError(null)} />
          ) : repos.length === 0 ? (
            isImported ? (
              <EmptyState type="empty" />
            ) : (
              <EmptyState type="initial" onOpenImport={() => setIsImportModalOpen(true)} />
            )
          ) : filteredAndSortedRepos.length === 0 ? (
            <EmptyState
              type="search"
              query={query}
              hasActiveFilters={hasActiveFilters}
              onClearQuery={() => setQuery('')}
              onReset={handleResetFilters}
            />
          ) : (
            <RepoGrid repos={filteredAndSortedRepos} />
          )}
        </section>
      </main>

      <footer className="border-t border-[#30363d] py-5 px-4 text-center text-xs text-github-muted">
        <p>
          <a
            href="https://github.com/denizyozgatli/starred-repos-classifier"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white underline decoration-github-muted underline-offset-2 transition-colors"
          >
            starred-repos-classifier
          </a>{' '}
          • Created by{' '}
          <a
            href="https://github.com/denizyozgatli"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white underline decoration-github-muted underline-offset-2 transition-colors"
          >
            Deniz Yozgatlı
          </a>
        </p>
      </footer>

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImport}
        isImported={isImported}
        importedFileName={importedFileName ?? undefined}
        onResetToDefault={handleResetToDefault}
        defaultRepoCount={0}
      />
    </div>
  );
}
