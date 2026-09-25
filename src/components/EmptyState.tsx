import React from 'react';
import { SearchX, Inbox, AlertTriangle, RefreshCw, X } from 'lucide-react';

interface EmptyStateProps {
  type: 'search' | 'empty' | 'error';
  query?: string;
  hasActiveFilters?: boolean;
  message?: string;
  onClearQuery?: () => void;
  onReset?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  type,
  query,
  hasActiveFilters,
  message,
  onClearQuery,
  onReset,
}) => {
  if (type === 'error') {
    return (
      <div className="flex flex-col items-center justify-center p-8 sm:p-10 text-center bg-[#161b22] border border-[#f85149]/30 rounded-xl my-6">
        <div className="w-10 h-10 rounded-full bg-[#f85149]/10 flex items-center justify-center text-[#f85149] mb-3">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-white mb-1.5">Failed to load repositories</h3>
        <p className="text-xs text-github-muted max-w-md mb-4 leading-relaxed">
          {message || 'An error occurred while loading the repository dataset. Please ensure data/repos.json is generated.'}
        </p>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#21262d] border border-[#30363d] hover:bg-[#30363d] text-white rounded-lg text-xs font-medium focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Try again
          </button>
        )}
      </div>
    );
  }

  if (type === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center p-8 sm:p-10 text-center bg-[#161b22] border border-[#30363d] rounded-xl my-6">
        <div className="w-10 h-10 rounded-full bg-[#21262d] flex items-center justify-center text-github-muted mb-3">
          <Inbox className="w-5 h-5" aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-white mb-1.5">No starred repositories</h3>
        <p className="text-xs text-github-muted max-w-md leading-relaxed">
          No repositories found in the dataset. Run the pipeline to fetch your stars from GitHub.
        </p>
      </div>
    );
  }

  const trimmedQuery = query?.trim();

  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-10 text-center bg-[#161b22] border border-[#30363d] rounded-xl my-6">
      <div className="w-10 h-10 rounded-full bg-[#21262d] flex items-center justify-center text-github-muted mb-3">
        <SearchX className="w-5 h-5" aria-hidden="true" />
      </div>

      <h3 className="text-base font-semibold text-white mb-1.5">
        {trimmedQuery ? (
          <span>
            No repositories matching <span className="text-[#58a6ff]">"{trimmedQuery}"</span>
          </span>
        ) : (
          <span>No matching repositories</span>
        )}
      </h3>

      <p className="text-xs text-github-muted max-w-md mb-4 leading-relaxed">
        {message ||
          (trimmedQuery && hasActiveFilters
            ? 'No repositories match your search with the active category or language filters applied.'
            : trimmedQuery
            ? 'Check the spelling or try searching for a different keyword or topic.'
            : 'No repositories match the currently active category and language filters.')}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {trimmedQuery && onClearQuery && (
          <button
            type="button"
            onClick={onClearQuery}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-white border border-[#30363d] rounded-lg text-xs font-medium focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            Clear search
          </button>
        )}

        {hasActiveFilters && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1f6feb]/20 hover:bg-[#1f6feb]/30 text-[#58a6ff] border border-[#1f6feb]/40 rounded-lg text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors"
          >
            Reset all filters
          </button>
        )}

        {!trimmedQuery && !hasActiveFilters && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1f6feb] hover:bg-[#388bfd] text-white rounded-lg text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors"
          >
            Reset view
          </button>
        )}
      </div>
    </div>
  );
};
