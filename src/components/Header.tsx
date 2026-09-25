import React from 'react';
import { Star } from 'lucide-react';

interface HeaderProps {
  totalCount: number;
  filteredCount: number;
}

export const Header: React.FC<HeaderProps> = ({ totalCount, filteredCount }) => {
  const isFiltered = totalCount !== filteredCount;

  return (
    <header className="border-b border-[#30363d] bg-[#161b22]/85 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-8 py-3 transition-colors shadow-sm">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Brand identity */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#e3b341]/10 border border-[#e3b341]/30 flex items-center justify-center text-[#e3b341] shrink-0">
            <Star className="w-4 h-4 fill-[#e3b341]" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-white tracking-tight leading-none">
              Starred Repositories
            </h1>
            <p className="text-[11px] text-github-muted mt-1 leading-none">
              Personal developer catalog
            </p>
          </div>
        </div>

        {/* Counter & GitHub Profile Access */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className="text-xs font-medium text-github-muted bg-[#21262d] px-2.5 sm:px-3 py-1 rounded-full border border-[#30363d] whitespace-nowrap"
            aria-live="polite"
          >
            {isFiltered ? (
              <span>
                <strong className="text-white font-semibold">{filteredCount}</strong> of{' '}
                {totalCount} repos
              </span>
            ) : (
              <span>
                <strong className="text-white font-semibold">{totalCount}</strong> repos
              </span>
            )}
          </div>

          <a
            href="https://github.com/denizyozgatli"
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-[40px] min-h-[40px] p-2 text-github-muted hover:text-white rounded-lg hover:bg-[#21262d] focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none flex items-center justify-center transition-colors"
            aria-label="Deniz Yozgatli's GitHub Profile (opens in new tab)"
            title="GitHub Profile (@denizyozgatli)"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
};
