import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowDownUp, ChevronDown, Check } from 'lucide-react';
import type { SortOption } from '../lib/sorting.ts';

interface SortSelectorProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
}

interface SortItem {
  value: SortOption;
  label: string;
}

const SORT_OPTIONS: SortItem[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'stars', label: 'Most Stars' },
  { value: 'updated', label: 'Recently Updated' },
  { value: 'name', label: 'Name (A–Z)' },
];

export const SortSelector: React.FC<SortSelectorProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedOption = SORT_OPTIONS.find(opt => opt.value === value) || SORT_OPTIONS[0];
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Sync highlighted index with current selected value when opened
  useEffect(() => {
    const idx = SORT_OPTIONS.findIndex(opt => opt.value === value);
    setHighlightedIndex(idx >= 0 ? idx : 0);
  }, [value, isOpen]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = useCallback(
    (optionValue: SortOption) => {
      onChange(optionValue);
      setIsOpen(false);
      buttonRef.current?.focus();
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
        break;

      case 'Tab':
        setIsOpen(false);
        break;

      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => (prev + 1) % SORT_OPTIONS.length);
        break;

      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev - 1 + SORT_OPTIONS.length) % SORT_OPTIONS.length);
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (SORT_OPTIONS[highlightedIndex]) {
          handleSelect(SORT_OPTIONS[highlightedIndex].value);
        }
        break;

      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block w-full sm:w-auto" onKeyDown={handleKeyDown}>
      <label htmlFor="repo-sort-btn" className="sr-only">
        Sort repositories
      </label>

      {/* Dropdown Trigger Button */}
      <button
        ref={buttonRef}
        id="repo-sort-btn"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="repo-sort-menu"
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full sm:w-auto min-h-[40px] sm:min-h-[38px] px-3 py-2 bg-[#161b22] border border-[#30363d] rounded-lg text-xs font-medium text-[#c9d1d9] hover:border-[#8b949e]/50 hover:bg-[#21262d]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:border-transparent flex items-center justify-between sm:justify-start gap-2.5 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2 text-github-muted shrink-0">
          <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
        <span className="text-[#c9d1d9] truncate font-medium">{selectedOption.label}</span>
        <span className="flex items-center text-github-muted ml-auto sm:ml-1 shrink-0">
          <ChevronDown
            className={isOpen ? 'w-3.5 h-3.5 transition-transform duration-150 rotate-180 text-white' : 'w-3.5 h-3.5 transition-transform duration-150'}
            aria-hidden="true"
          />
        </span>
      </button>

      {/* Accessible Listbox Menu */}
      {isOpen && (
        <ul
          id="repo-sort-menu"
          role="listbox"
          aria-label="Sort options"
          tabIndex={-1}
          className="absolute right-0 top-full mt-1.5 z-50 w-full sm:w-48 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl py-1 text-xs focus:outline-none"
        >
          {SORT_OPTIONS.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightedIndex;

            let itemClass = 'flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition-colors ';
            if (isSelected) {
              itemClass += 'bg-[#1f6feb]/15 text-[#58a6ff] font-semibold';
            } else if (isHighlighted) {
              itemClass += 'bg-[#21262d] text-white';
            } else {
              itemClass += 'text-[#c9d1d9] hover:bg-[#21262d] hover:text-white';
            }

            return (
              <li
                key={option.value}
                id={`sort-opt-${option.value}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(option.value)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={itemClass}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-[#58a6ff] shrink-0" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
