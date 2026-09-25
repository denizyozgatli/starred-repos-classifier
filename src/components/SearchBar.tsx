import React, { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  onClear,
  placeholder = 'Search repositories by name, owner, description, topic...',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus shortcut on '/'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        // Only focus if not in an input/textarea
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          inputRef.current?.focus();
        }
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative w-full">
      <label htmlFor="repo-search" className="sr-only">
        Search repositories
      </label>
      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-github-muted">
        <Search className="w-4 h-4" />
      </div>
      <input
        ref={inputRef}
        id="repo-search"
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-20 py-2.5 bg-[#161b22] border border-[#30363d] rounded-lg text-sm text-[#c9d1d9] placeholder-github-muted focus:outline-none focus:ring-2 focus:ring-[#58a6ff] focus:border-transparent transition-all"
        autoComplete="off"
        spellCheck="false"
      />
      <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-1.5">
        {value ? (
          <button
            type="button"
            onClick={onClear}
            className="p-1 text-github-muted hover:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-[#58a6ff]"
            aria-label="Clear search query"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium text-github-muted bg-[#21262d] border border-[#30363d] rounded">
            /
          </kbd>
        )}
      </div>
    </div>
  );
};
