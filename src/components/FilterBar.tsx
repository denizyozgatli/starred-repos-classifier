import React from 'react';
import { Filter, X, Check } from 'lucide-react';
import type { RepositoryCategory } from '../types/repo.ts';
import type { DynamicFilterOptions } from '../lib/filters.ts';

interface FilterBarProps {
  filterOptions: DynamicFilterOptions;
  selectedCategories: RepositoryCategory[];
  selectedLanguages: string[];
  onToggleCategory: (category: RepositoryCategory) => void;
  onToggleLanguage: (language: string) => void;
  onClearAll: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filterOptions,
  selectedCategories,
  selectedLanguages,
  onToggleCategory,
  onToggleLanguage,
  onClearAll,
}) => {
  const hasActiveFilters = selectedCategories.length > 0 || selectedLanguages.length > 0;

  return (
    <div className="space-y-3">
      {/* Category Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-github-muted uppercase tracking-wider mr-1 flex items-center gap-1">
          <Filter className="w-3 h-3" /> Category:
        </span>
        {filterOptions.categories.map(cat => {
          const isSelected = selectedCategories.includes(cat.value);
          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => onToggleCategory(cat.value)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                isSelected
                  ? 'bg-[#1f6feb] text-white shadow-sm ring-1 ring-[#388bfd]'
                  : 'bg-[#161b22] text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] hover:text-white'
              }`}
              aria-pressed={isSelected}
            >
              {isSelected && <Check className="w-3 h-3" />}
              <span>{cat.label}</span>
              <span
                className={`text-[10px] px-1 py-0.2 rounded-full ${
                  isSelected ? 'bg-[#0f4bb8] text-blue-100' : 'bg-[#21262d] text-github-muted'
                }`}
              >
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Language Pills (if available) */}
      {filterOptions.languages.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-github-muted uppercase tracking-wider mr-1">
            Language:
          </span>
          {filterOptions.languages.map(lang => {
            const isSelected = selectedLanguages.includes(lang.value);
            return (
              <button
                key={lang.value}
                type="button"
                onClick={() => onToggleLanguage(lang.value)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  isSelected
                    ? 'bg-[#238636] text-white shadow-sm ring-1 ring-[#2ea043]'
                    : 'bg-[#161b22] text-[#c9d1d9] border border-[#30363d] hover:bg-[#21262d] hover:text-white'
                }`}
                aria-pressed={isSelected}
              >
                {isSelected && <Check className="w-3 h-3" />}
                <span>{lang.label}</span>
                <span
                  className={`text-[10px] px-1 py-0.2 rounded-full ${
                    isSelected ? 'bg-[#196328] text-green-100' : 'bg-[#21262d] text-github-muted'
                  }`}
                >
                  {lang.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active Filter Chips & Clear All */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#21262d]">
          <span className="text-xs text-github-muted">Active:</span>
          {selectedCategories.map(cat => (
            <button
              key={`active-${cat}`}
              type="button"
              onClick={() => onToggleCategory(cat)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/40 hover:bg-[#1f6feb]/30"
            >
              <span>{cat}</span>
              <X className="w-3 h-3" />
            </button>
          ))}
          {selectedLanguages.map(lang => (
            <button
              key={`active-${lang}`}
              type="button"
              onClick={() => onToggleLanguage(lang)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 hover:bg-[#238636]/30"
            >
              <span>{lang}</span>
              <X className="w-3 h-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs text-github-muted hover:text-[#f85149] underline ml-1 cursor-pointer transition-colors"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
};
