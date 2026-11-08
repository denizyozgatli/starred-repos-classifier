import React, { useState, useMemo } from 'react';
import { Filter, X, Check, ChevronDown, ChevronUp, Bookmark } from 'lucide-react';
import type { RepositoryCategory } from '../types/repo.ts';
import type { DynamicFilterOptions } from '../lib/filters.ts';
import { getLanguageColor } from '../lib/languageColors.ts';

interface FilterBarProps {
  filterOptions: DynamicFilterOptions;
  selectedCategories: RepositoryCategory[];
  selectedLanguages: string[];
  selectedList: string | null;
  onToggleCategory: (category: RepositoryCategory) => void;
  onToggleLanguage: (language: string) => void;
  onSelectList: (list: string | null) => void;
  onClearAll: () => void;
}

const TOP_LANGUAGES_COUNT = 5;

export const FilterBar: React.FC<FilterBarProps> = ({
  filterOptions,
  selectedCategories,
  selectedLanguages,
  selectedList,
  onToggleCategory,
  onToggleLanguage,
  onSelectList,
  onClearAll,
}) => {
  const [showAllLanguages, setShowAllLanguages] = useState(false);

  const activeCount =
    selectedCategories.length +
    selectedLanguages.length +
    (selectedList ? 1 : 0);
  const hasActiveFilters = activeCount > 0;

  // Partition languages into primary (top 5 + any actively selected) and secondary
  const { visibleLanguages, overflowLanguages, remainingCount } = useMemo(() => {
    const all = filterOptions.languages;
    if (all.length <= TOP_LANGUAGES_COUNT) {
      return { visibleLanguages: all, overflowLanguages: [], remainingCount: 0 };
    }

    const selectedSet = new Set(selectedLanguages);
    const top = all.slice(0, TOP_LANGUAGES_COUNT);
    const rest = all.slice(TOP_LANGUAGES_COUNT);

    // If an overflow language is currently selected, hoist it into visible
    const hoisted = rest.filter(l => selectedSet.has(l.value));
    const remaining = rest.filter(l => !selectedSet.has(l.value));

    const visible = [...top, ...hoisted];
    return {
      visibleLanguages: showAllLanguages ? all : visible,
      overflowLanguages: remaining,
      remainingCount: remaining.length,
    };
  }, [filterOptions.languages, selectedLanguages, showAllLanguages]);

  return (
    <div className="space-y-2.5">
      {/* Top Filter Bar Header: Compact Label & Clear All */}
      <div className="flex items-center justify-between text-xs text-github-muted pb-1 border-b border-[#21262d]">
        <div className="flex items-center gap-1.5 font-medium">
          <Filter className="w-3.5 h-3.5 text-[#58a6ff]" aria-hidden="true" />
          <span className="text-[#c9d1d9]">Filter Collection</span>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1 text-xs text-github-muted hover:text-[#f85149] focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none rounded px-1.5 py-0.5 transition-colors cursor-pointer"
            aria-label={`Clear all ${activeCount} active filters`}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reset filters ({activeCount})</span>
          </button>
        )}
      </div>

      {/* Star List Pills (Rendered when dataset contains Star Lists or a list is actively selected) */}
      {((filterOptions.lists && filterOptions.lists.length > 0) || selectedList !== null) && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-github-muted inline-flex items-center gap-1">
              <Bookmark className="w-3 h-3 text-[#d2a8ff]" aria-hidden="true" />
              <span>Star List</span>
            </span>
            <span className="sm:hidden text-[10px] text-github-muted">Scroll →</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 sm:pb-0 sm:flex-wrap no-scrollbar touch-pan-x">
            <button
              type="button"
              onClick={() => onSelectList(null)}
              className={`min-h-[34px] sm:min-h-[28px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none cursor-pointer ${
                selectedList === null
                  ? 'bg-[#a371f7]/20 text-[#d2a8ff] border border-[#a371f7]/60 ring-1 ring-[#a371f7]/30 shadow-xs'
                  : 'bg-[#21262d]/60 text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] hover:text-white hover:border-[#8b949e]/40'
              }`}
              aria-pressed={selectedList === null}
            >
              {selectedList === null && <Check className="w-3 h-3 text-[#d2a8ff] shrink-0" aria-hidden="true" />}
              <span>All Lists</span>
            </button>

            {filterOptions.lists.map(list => {
              const isSelected = selectedList === list.value;
              return (
                <button
                  key={list.value}
                  type="button"
                  onClick={() => onSelectList(isSelected ? null : list.value)}
                  className={`min-h-[34px] sm:min-h-[28px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none cursor-pointer ${
                    isSelected
                      ? 'bg-[#a371f7]/20 text-[#d2a8ff] border border-[#a371f7]/60 ring-1 ring-[#a371f7]/30 shadow-xs'
                      : 'bg-[#21262d]/60 text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] hover:text-white hover:border-[#8b949e]/40'
                  }`}
                  aria-pressed={isSelected}
                >
                  {isSelected && <Check className="w-3 h-3 text-[#d2a8ff] shrink-0" aria-hidden="true" />}
                  <span>{list.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isSelected
                        ? 'bg-[#a371f7]/30 text-[#d2a8ff]'
                        : 'bg-[#161b22] text-github-muted'
                    }`}
                  >
                    {list.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Category Pills (Horizontal scroll on mobile, wrap on desktop) */}
      <div className={`space-y-1 ${((filterOptions.lists && filterOptions.lists.length > 0) || selectedList !== null) ? 'pt-1 border-t border-[#21262d]' : ''}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-github-muted">
            Category
          </span>
          <span className="sm:hidden text-[10px] text-github-muted">Scroll →</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 sm:pb-0 sm:flex-wrap no-scrollbar touch-pan-x">
          {filterOptions.categories.map(cat => {
            const isSelected = selectedCategories.includes(cat.value);
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => onToggleCategory(cat.value)}
                className={`min-h-[34px] sm:min-h-[28px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none cursor-pointer ${
                  isSelected
                    ? 'bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/60 ring-1 ring-[#1f6feb]/30 shadow-xs'
                    : 'bg-[#21262d]/60 text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] hover:text-white hover:border-[#8b949e]/40'
                }`}
                aria-pressed={isSelected}
              >
                {isSelected && <Check className="w-3 h-3 text-[#58a6ff] shrink-0" aria-hidden="true" />}
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isSelected
                      ? 'bg-[#1f6feb]/30 text-[#58a6ff]'
                      : 'bg-[#161b22] text-github-muted'
                  }`}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Language Pills (Compact Top-Languages + Expandable More) */}
      {filterOptions.languages.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-[#21262d]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-github-muted">
              Language
            </span>
            <span className="sm:hidden text-[10px] text-github-muted">Scroll →</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 sm:pb-0 sm:flex-wrap no-scrollbar touch-pan-x">
            {visibleLanguages.map(lang => {
              const isSelected = selectedLanguages.includes(lang.value);
              const langColor = getLanguageColor(lang.value);
              return (
                <button
                  key={lang.value}
                  type="button"
                  onClick={() => onToggleLanguage(lang.value)}
                  className={`min-h-[34px] sm:min-h-[28px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none cursor-pointer ${
                    isSelected
                      ? 'bg-[#238636]/20 text-[#3fb950] border border-[#238636]/60 ring-1 ring-[#238636]/30 shadow-xs'
                      : 'bg-[#21262d]/60 text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] hover:text-white hover:border-[#8b949e]/40'
                  }`}
                  aria-pressed={isSelected}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: langColor }}
                    aria-hidden="true"
                  />
                  <span>{lang.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isSelected
                        ? 'bg-[#238636]/30 text-[#3fb950]'
                        : 'bg-[#161b22] text-github-muted'
                    }`}
                  >
                    {lang.count}
                  </span>
                </button>
              );
            })}

            {/* Expand / Collapse Remaining Languages */}
            {overflowLanguages.length > 0 && !showAllLanguages && (
              <button
                type="button"
                onClick={() => setShowAllLanguages(true)}
                className="min-h-[34px] sm:min-h-[28px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-github-muted hover:text-white bg-[#21262d]/30 border border-dashed border-[#30363d] hover:border-[#8b949e]/60 focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors cursor-pointer"
                aria-expanded={false}
                aria-label={`Show ${remainingCount} more languages`}
              >
                <span>+{remainingCount} more</span>
                <ChevronDown className="w-3 h-3" aria-hidden="true" />
              </button>
            )}

            {showAllLanguages && filterOptions.languages.length > TOP_LANGUAGES_COUNT && (
              <button
                type="button"
                onClick={() => setShowAllLanguages(false)}
                className="min-h-[34px] sm:min-h-[28px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-github-muted hover:text-white bg-[#21262d]/30 border border-[#30363d] hover:border-[#8b949e]/60 focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors cursor-pointer"
                aria-expanded={true}
                aria-label="Show fewer languages"
              >
                <span>Show less</span>
                <ChevronUp className="w-3 h-3" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
