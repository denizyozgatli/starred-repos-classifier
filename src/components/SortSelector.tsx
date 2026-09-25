import React from 'react';
import { ArrowDownUp } from 'lucide-react';
import type { SortOption } from '../lib/sorting.ts';

interface SortSelectorProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

export const SortSelector: React.FC<SortSelectorProps> = ({ value, onChange }) => {
  return (
    <div className="relative inline-flex items-center">
      <label htmlFor="repo-sort" className="sr-only">
        Sort repositories
      </label>
      <div className="absolute left-3 pointer-events-none text-github-muted">
        <ArrowDownUp className="w-3.5 h-3.5" />
      </div>
      <select
        id="repo-sort"
        value={value}
        onChange={e => onChange(e.target.value as SortOption)}
        className="pl-8 pr-8 py-2 bg-[#161b22] border border-[#30363d] rounded-lg text-xs font-medium text-[#c9d1d9] focus:outline-none focus:ring-2 focus:ring-[#58a6ff] focus:border-transparent appearance-none cursor-pointer hover:border-gray-500 transition-colors"
      >
        <option value="relevance">Sort: Relevance / Default</option>
        <option value="stars">Sort: Most Stars ⭐</option>
        <option value="updated">Sort: Recently Updated 🕒</option>
        <option value="name">Sort: Name (A-Z)</option>
      </select>
      <div className="absolute right-2.5 pointer-events-none text-github-muted text-xs">
        ▼
      </div>
    </div>
  );
};
