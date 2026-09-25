import React from 'react';
import { ArrowDownUp, ChevronDown } from 'lucide-react';
import type { SortOption } from '../lib/sorting.ts';

interface SortSelectorProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

export const SortSelector: React.FC<SortSelectorProps> = ({ value, onChange }) => {
  return (
    <div className="relative inline-flex items-center w-full sm:w-auto">
      <label htmlFor="repo-sort" className="sr-only">
        Sort repositories
      </label>
      <div className="absolute left-3 pointer-events-none text-github-muted flex items-center">
        <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
      </div>
      <select
        id="repo-sort"
        value={value}
        onChange={e => onChange(e.target.value as SortOption)}
        className="w-full sm:w-auto pl-8 pr-8 py-2.5 sm:py-2 min-h-[40px] sm:min-h-[38px] bg-[#161b22] border border-[#30363d] rounded-lg text-xs font-medium text-[#c9d1d9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:border-transparent appearance-none cursor-pointer hover:border-[#8b949e]/50 hover:bg-[#21262d]/50 transition-colors"
      >
        <option value="relevance">Relevance</option>
        <option value="stars">Most Stars</option>
        <option value="updated">Recently Updated</option>
        <option value="name">Name (A–Z)</option>
      </select>
      <div className="absolute right-2.5 pointer-events-none text-github-muted flex items-center">
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </div>
    </div>
  );
};
