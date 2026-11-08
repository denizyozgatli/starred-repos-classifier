import React, { useMemo } from 'react';
import { Star, Upload, RefreshCw, LogOut, Settings } from 'lucide-react';
import type { Repository } from '../types/repo.ts';
import type { ExportFilterContext } from '../lib/export.ts';
import { ExportMenu } from './ExportMenu.tsx';

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - date.getTime()) / 1000));

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

interface HeaderProps {
  totalCount: number;
  filteredCount: number;
  datasetOwner?: string;
  isImported?: boolean;
  importedFileName?: string;
  onOpenImport: () => void;
  onClearImport?: () => void;
  repos: Repository[];
  filteredRepos: Repository[];
  filterContext?: ExportFilterContext;
  isConnected?: boolean;
  viewerLogin?: string | null;
  lastSyncAt?: string | null;
  isSyncing?: boolean;
  onRefresh?: () => void;
  onDisconnect?: () => void;
  onOpenSettings?: () => void;
  hasGeminiKey?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  totalCount,
  filteredCount,
  datasetOwner,
  isImported = false,
  importedFileName,
  onOpenImport,
  onClearImport,
  repos,
  filteredRepos,
  filterContext,
  isConnected = false,
  viewerLogin,
  lastSyncAt,
  isSyncing = false,
  onRefresh,
  onDisconnect,
  onOpenSettings,
  hasGeminiKey = false,
}) => {
  const isFiltered = totalCount !== filteredCount;
  const relativeSyncTime = useMemo(() => formatRelativeTime(lastSyncAt ?? null), [lastSyncAt]);

  const handleDisconnect = () => {
    if (!onDisconnect) return;
    const confirmed = window.confirm(
      'Disconnect your GitHub account and clear cached repositories on this device?'
    );
    if (confirmed) {
      onDisconnect();
    }
  };

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
            {isImported ? (
              <div className="flex items-center gap-1.5 mt-1 leading-none">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#a371f7]/15 text-[#d2a8ff] border border-[#a371f7]/30 max-w-[180px] sm:max-w-xs truncate">
                  Imported: {importedFileName || 'local file'}
                </span>
                {onClearImport && (
                  <button
                    type="button"
                    onClick={onClearImport}
                    className="text-[11px] text-github-muted hover:text-white underline decoration-github-muted underline-offset-2 transition-colors cursor-pointer"
                    title="Clear imported dataset"
                  >
                    Clear
                  </button>
                )}
              </div>
            ) : isConnected && viewerLogin ? (
              <div className="flex items-center gap-1.5 mt-1 leading-none text-[11px] text-github-muted">
                <span className="font-medium text-white/90">@{viewerLogin}</span>
                {relativeSyncTime && (
                  <>
                    <span>•</span>
                    <span>Last synced {relativeSyncTime}</span>
                  </>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-github-muted mt-1 leading-none">
                {datasetOwner ? `Starred by @${datasetOwner}` : 'Personal developer catalog'}
              </p>
            )}
          </div>
        </div>

        {/* Counter, Actions & Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div className="flex items-center gap-1.5">
            {isConnected && onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg border border-[#30363d] bg-[#21262d] text-white/90 hover:bg-[#30363d] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none cursor-pointer"
                title={isSyncing ? 'Syncing…' : 'Refresh starred repositories'}
                aria-label="Refresh starred repositories"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span className="hidden sm:inline">{isSyncing ? 'Syncing…' : 'Refresh'}</span>
              </button>
            )}

            {isConnected && onDisconnect && (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg border border-[#30363d] bg-[#21262d] text-[#ff7b72] hover:bg-[#f85149]/15 hover:border-[#f85149]/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-[#f85149] focus-visible:outline-none cursor-pointer"
                title="Disconnect GitHub account"
                aria-label="Disconnect GitHub account"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Disconnect</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenImport}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-medium rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none cursor-pointer ${
                isImported
                  ? 'bg-[#a371f7]/15 border-[#a371f7]/40 text-[#d2a8ff] hover:bg-[#a371f7]/25'
                  : 'bg-[#21262d] border-[#30363d] text-white/90 hover:bg-[#30363d] hover:text-white'
              }`}
              title="Import a local repos.json dataset"
              aria-label="Import a local repos.json dataset"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Import JSON</span>
              <span className="sm:hidden">Import</span>
            </button>

            <ExportMenu
              repos={repos}
              filteredRepos={filteredRepos}
              filterContext={filterContext}
            />

            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="relative inline-flex items-center justify-center p-2 text-github-muted hover:text-white rounded-lg hover:bg-[#21262d] border border-[#30363d] focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors cursor-pointer"
                title="Classification settings"
                aria-label="Open classification settings"
              >
                <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                {hasGeminiKey && (
                  <span
                    className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#3fb950]"
                    title="Gemini API key configured"
                  />
                )}
              </button>
            )}
          </div>

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

          {datasetOwner ? (
            <a
              href={`https://github.com/${datasetOwner}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-[40px] min-h-[40px] p-2 text-github-muted hover:text-white rounded-lg hover:bg-[#21262d] focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none flex items-center justify-center transition-colors"
              aria-label={`@${datasetOwner}'s GitHub Profile (opens in new tab)`}
              title={`GitHub Profile (@${datasetOwner})`}
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
          ) : (
            <a
              href="https://github.com/denizyozgatli/starred-repos-classifier"
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-[40px] min-h-[40px] p-2 text-github-muted hover:text-white rounded-lg hover:bg-[#21262d] focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none flex items-center justify-center transition-colors"
              aria-label="View source repository on GitHub (opens in new tab)"
              title="View source repository on GitHub"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
