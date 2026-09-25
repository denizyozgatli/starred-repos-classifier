import React from 'react';
import { SearchX, Inbox, AlertTriangle, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  type: 'search' | 'empty' | 'error';
  message?: string;
  onReset?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ type, message, onReset }) => {
  if (type === 'error') {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-[#161b22] border border-[#f85149]/30 rounded-xl my-8">
        <div className="w-12 h-12 rounded-full bg-[#f85149]/10 flex items-center justify-center text-[#f85149] mb-4">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">Failed to load repositories</h3>
        <p className="text-sm text-github-muted max-w-md mb-6 leading-relaxed">
          {message || 'An error occurred while loading the repository dataset. Please ensure data/repos.json is generated.'}
        </p>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#21262d] border border-[#30363d] hover:bg-[#30363d] text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        )}
      </div>
    );
  }

  if (type === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-[#161b22] border border-[#30363d] rounded-xl my-8">
        <div className="w-12 h-12 rounded-full bg-[#21262d] flex items-center justify-center text-github-muted mb-4">
          <Inbox className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">No starred repositories</h3>
        <p className="text-sm text-github-muted max-w-md leading-relaxed">
          No repositories found in the dataset. Run the pipeline to fetch your stars from GitHub.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-[#161b22] border border-[#30363d] rounded-xl my-8">
      <div className="w-12 h-12 rounded-full bg-[#21262d] flex items-center justify-center text-github-muted mb-4">
        <SearchX className="w-6 h-6" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">No repositories found</h3>
      <p className="text-sm text-github-muted max-w-md mb-6 leading-relaxed">
        {message || 'Try changing your search terms or clearing some of your active filters.'}
      </p>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1f6feb] hover:bg-[#388bfd] text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
        >
          Reset search & filters
        </button>
      )}
    </div>
  );
};
