import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Download, ChevronDown, Info } from 'lucide-react';
import type { Repository } from '../types/repo.ts';
import {
  exportToJson,
  exportToCsv,
  exportToMarkdown,
  type ExportFilterContext,
  type ExportFormat,
  type ExportScope,
} from '../lib/export.ts';

export const IMPORT_SUPPORT_NOTE = 'Import supports JSON files only.';

interface ExportMenuProps {
  repos: Repository[];
  filteredRepos: Repository[];
  filterContext?: ExportFilterContext;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({
  repos,
  filteredRepos,
  filterContext,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isFiltered = Boolean(filterContext?.isFiltered);

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

  const handleExport = useCallback(
    (format: ExportFormat, scope: ExportScope) => {
      const targetRepos = scope === 'filtered' ? filteredRepos : repos;
      const isFilteredScope = scope === 'filtered';
      const suffix = isFilteredScope ? '-filtered' : '';

      switch (format) {
        case 'json':
          exportToJson(targetRepos, `starred-repos${suffix}.json`);
          break;
        case 'csv':
          exportToCsv(targetRepos, `starred-repos${suffix}.csv`);
          break;
        case 'markdown':
          exportToMarkdown(
            targetRepos,
            isFilteredScope ? filterContext : undefined,
            `starred-repos${suffix}.md`
          );
          break;
      }

      setIsOpen(false);
      buttonRef.current?.focus();
    },
    [filteredRepos, repos, filterContext]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block" onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        id="export-dropdown-btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="export-menu-dropdown"
        onClick={() => setIsOpen(prev => !prev)}
        className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg border border-[#30363d] bg-[#21262d] text-white/90 hover:bg-[#30363d] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] transition-colors cursor-pointer"
        title="Export repositories (JSON, CSV, Markdown)"
        aria-label="Export repositories"
      >
        <Download className="w-3.5 h-3.5 text-github-muted shrink-0" aria-hidden="true" />
        <span>Export</span>
        <ChevronDown
          className={
            isOpen
              ? 'w-3 h-3 transition-transform duration-150 rotate-180 text-white shrink-0'
              : 'w-3 h-3 transition-transform duration-150 text-github-muted shrink-0'
          }
          aria-hidden="true"
        />
      </button>

      {/* Accessible Dropdown Menu */}
      {isOpen && (
        <div
          id="export-menu-dropdown"
          role="menu"
          aria-label="Export options"
          className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl py-1 text-xs focus:outline-none divide-y divide-[#30363d]/60"
        >
          {/* Section 1: Filtered Scope (shown when filters/search are active) */}
          {isFiltered && (
            <div className="py-1">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-github-muted uppercase tracking-wider flex items-center justify-between">
                <span>Export Filtered</span>
                <span className="text-[#58a6ff] font-mono">{filteredRepos.length} repos</span>
              </div>
              <button
                role="menuitem"
                type="button"
                onClick={() => handleExport('json', 'filtered')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition-colors cursor-pointer"
              >
                <span className="font-medium">JSON</span>
                <span className="text-[11px] text-github-muted font-mono">.json</span>
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => handleExport('csv', 'filtered')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition-colors cursor-pointer"
              >
                <span className="font-medium">CSV</span>
                <span className="text-[11px] text-github-muted font-mono">.csv</span>
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => handleExport('markdown', 'filtered')}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition-colors cursor-pointer"
              >
                <span className="font-medium">Markdown</span>
                <span className="text-[11px] text-github-muted font-mono">.md</span>
              </button>
            </div>
          )}

          {/* Section 2: All Repositories Scope */}
          <div className="py-1">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-github-muted uppercase tracking-wider flex items-center justify-between">
              <span>Export All</span>
              <span className="text-[#8b949e] font-mono">{repos.length} repos</span>
            </div>
            <button
              role="menuitem"
              type="button"
              onClick={() => handleExport('json', 'all')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition-colors cursor-pointer"
            >
              <span className="font-medium">JSON</span>
              <span className="text-[11px] text-github-muted font-mono">.json</span>
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => handleExport('csv', 'all')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition-colors cursor-pointer"
            >
              <span className="font-medium">CSV</span>
              <span className="text-[11px] text-github-muted font-mono">.csv</span>
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => handleExport('markdown', 'all')}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left text-[#c9d1d9] hover:bg-[#21262d] hover:text-white transition-colors cursor-pointer"
            >
              <span className="font-medium">Markdown</span>
              <span className="text-[11px] text-github-muted font-mono">.md</span>
            </button>
          </div>

          {/* Informational Note: Clarifies that Import supports JSON files only */}
          <div className="px-3 py-2 text-[11px] text-github-muted flex items-start gap-1.5 bg-[#0d1117]/40 select-none">
            <Info className="w-3.5 h-3.5 text-github-muted shrink-0 mt-0.5" aria-hidden="true" />
            <span className="leading-snug">{IMPORT_SUPPORT_NOTE}</span>
          </div>
        </div>
      )}
    </div>
  );
};
