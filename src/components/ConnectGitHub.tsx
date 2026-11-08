import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  ExternalLink,
  Upload,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import type { SyncProgress, SyncPhase } from '../lib/sync.ts';
import type { ActivityLogEntry } from '../lib/activityLog.ts';
import { SyncLog } from './SyncLog.tsx';

interface ConnectGitHubProps {
  onConnect: (token: string, remember: boolean) => Promise<boolean>;
  onCancel?: () => void;
  onOpenImport: () => void;
  isSyncing?: boolean;
  phase?: SyncPhase | null;
  progress?: SyncProgress;
  error?: string | null;
  onClearError?: () => void;
  hasLoadedDataset?: boolean;
  activityLog?: ReadonlyArray<ActivityLogEntry>;
  onClearActivityLog?: () => void;
}

export const ConnectGitHub: React.FC<ConnectGitHubProps> = ({
  onConnect,
  onCancel,
  onOpenImport,
  isSyncing = false,
  phase,
  progress,
  error,
  onClearError,
  hasLoadedDataset = false,
  activityLog,
  onClearActivityLog,
}) => {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const initialWaitSec = progress?.waitingMs && progress.waitingMs > 0 ? Math.ceil(progress.waitingMs / 1000) : 0;
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initialWaitSec);

  useEffect(() => {
    if (progress?.waitingMs && progress.waitingMs > 0) {
      const totalSec = Math.ceil(progress.waitingMs / 1000);
      setRemainingSeconds(totalSec);
      const intervalId = window.setInterval(() => {
        setRemainingSeconds(prev => {
          if (prev <= 1) {
            window.clearInterval(intervalId);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => window.clearInterval(intervalId);
    } else {
      setRemainingSeconds(0);
    }
  }, [progress?.waitingMs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed || isSyncing || submitting) return;

    setSubmitting(true);
    try {
      await onConnect(trimmed, remember);
    } finally {
      setSubmitting(false);
    }
  };

  // 1. Syncing State
  if (isSyncing) {
    const isLlm = phase === 'llm' || phase === 'waiting';
    const isClassifying = phase === 'classifying' || isLlm;
    const total = progress?.total ?? 0;
    const done = progress?.done ?? 0;
    const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

    return (
      <div className="max-w-xl mx-auto my-12 bg-[#161b22] border border-[#30363d] rounded-2xl p-6 sm:p-8 shadow-xl text-center space-y-6">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#58a6ff]/10 border border-[#58a6ff]/30 flex items-center justify-center text-[#58a6ff]">
          <Loader2 className="w-7 h-7 animate-spin" aria-hidden="true" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-bold text-white tracking-tight">
            Syncing Starred Repositories
          </h2>
          <p className="text-xs text-github-muted" aria-live="polite">
            {isLlm ? (
              <span>
                Classifying with AI <strong className="text-white font-mono">{done}</strong> /{' '}
                <span className="font-mono">{total || '…'}</span>
                {remainingSeconds > 0 && (
                  <span className="text-github-muted">{` · next in ${remainingSeconds}s`}</span>
                )}
              </span>
            ) : isClassifying ? (
              <span>
                Classifying repositories: <strong className="text-white font-mono">{done}</strong> /{' '}
                <span className="font-mono">{total || '…'}</span>
              </span>
            ) : (
              <span>
                Fetching stars… page <strong className="text-white font-mono">{progress?.page ?? 1}</strong> (
                <span className="font-mono">{done}</span> repos found)
              </span>
            )}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="relative w-full bg-[#21262d] rounded-full h-2.5 overflow-hidden border border-[#30363d]/60">
            {isClassifying && total > 0 ? (
              <div
                className="bg-[#238636] h-full transition-all duration-200 rounded-full"
                style={{ width: `${percent}%` }}
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            ) : (
              <div className="bg-[#58a6ff] h-full w-2/5 animate-pulse rounded-full" />
            )}
            {remainingSeconds > 0 && (
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer pointer-events-none"
                style={{ backgroundSize: '200% 100%' }}
                aria-hidden="true"
              />
            )}
          </div>
          {isClassifying && (progress?.repoName || progress?.currentRepo) && (
            <p className="text-[11px] text-github-muted truncate font-mono max-w-sm mx-auto">
              {progress.repoName ?? progress.currentRepo}
            </p>
          )}
        </div>

        {/* Collapsible Activity Disclosure */}
        <div className="pt-1">
          <SyncLog entries={activityLog ?? []} onClear={onClearActivityLog} />
        </div>

        {onCancel && (
          <div className="pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-[#21262d] hover:bg-[#30363d] text-white border border-[#30363d] rounded-lg text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors cursor-pointer"
            >
              Cancel sync
            </button>
          </div>
        )}
      </div>
    );
  }

  // 2. Main Connect Screen
  return (
    <div className="max-w-2xl mx-auto my-8 sm:my-12 space-y-6">
      <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#238636]/15 border border-[#238636]/30 flex items-center justify-center text-[#3fb950] shrink-0 mt-0.5">
              <KeyRound className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-snug">
                Connect your GitHub account
              </h2>
              <p className="text-xs sm:text-sm text-github-muted leading-relaxed">
                Fetch, classify, and organize your starred repositories directly in your browser. No server, no account creation, and zero telemetry.
              </p>
            </div>
          </div>
          {hasLoadedDataset && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-github-muted hover:text-white p-1.5 rounded-lg border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] transition-colors shrink-0 cursor-pointer"
              aria-label="Back to repositories"
              title="Back to repositories"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Inline Error Area */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 p-3.5 rounded-xl bg-[#f85149]/10 border border-[#f85149]/30 text-xs text-[#ff7b72] animate-in fade-in"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#f85149]" aria-hidden="true" />
            <div className="flex-1 leading-relaxed">{error}</div>
            {onClearError && (
              <button
                type="button"
                onClick={onClearError}
                className="text-github-muted hover:text-white p-0.5 rounded transition-colors"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="github-token-input"
              className="block text-xs font-semibold text-white/90"
            >
              GitHub Personal Access Token
            </label>
            <div className="relative">
              <input
                id="github-token-input"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={e => {
                  setToken(e.target.value);
                  if (error && onClearError) onClearError();
                }}
                placeholder="github_pat_... or ghp_..."
                autoComplete="off"
                spellCheck="false"
                className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#58a6ff] focus:ring-1 focus:ring-[#58a6ff] rounded-xl text-xs sm:text-sm font-mono px-3.5 py-2.5 pr-11 text-white placeholder:text-github-muted placeholder:font-sans focus-visible:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-github-muted hover:text-white p-1 rounded-md transition-colors"
                aria-label={showToken ? 'Hide token' : 'Show token'}
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember Checkbox */}
          <div className="space-y-1 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] text-[#238636] focus:ring-[#58a6ff] focus:ring-offset-0 transition-colors"
              />
              <span className="text-xs text-white/90 font-medium">Remember on this device</span>
            </label>
            {remember && (
              <p className="text-[11px] text-[#e3b341] pl-6 leading-relaxed">
                Warning: The token will be saved unencrypted in your browser's localStorage. Do not enable on public or shared computers.
              </p>
            )}
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="submit"
                disabled={!token.trim() || submitting}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs sm:text-sm font-semibold focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors cursor-pointer shadow-sm"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Connecting…</span>
                  </>
                ) : (
                  <span>Connect GitHub</span>
                )}
              </button>

              {hasLoadedDataset && onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex items-center justify-center px-4 py-2.5 bg-[#21262d] hover:bg-[#30363d] text-white border border-[#30363d] rounded-xl text-xs sm:text-sm font-medium focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:outline-none transition-colors cursor-pointer"
                >
                  Back to repositories
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenImport}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-github-muted hover:text-white transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Or import a JSON file</span>
            </button>
          </div>
        </form>

        {/* Instructions & Help */}
        <div className="border-t border-[#30363d] pt-5 space-y-3 text-xs text-github-muted leading-relaxed">
          <div className="flex items-start gap-2 text-white/90 font-medium">
            <span>How to create a token:</span>
          </div>
          <ol className="list-decimal list-inside space-y-1.5 pl-1">
            <li>
              Go to{' '}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#58a6ff] hover:underline inline-flex items-center gap-0.5"
              >
                GitHub Fine-Grained Personal Access Tokens
                <ExternalLink className="w-3 h-3 inline" />
              </a>
            </li>
            <li>
              Set Repository access to <strong className="text-white">Public repositories (read-only)</strong>.
            </li>
            <li>
              Under Account permissions, set <strong className="text-white">Starring</strong> to <strong className="text-white">Read-only</strong>.
            </li>
            <li>
              Generate the token and paste it above. Classic tokens (<code className="text-[#58a6ff]">ghp_...</code>) are also supported.
            </li>
          </ol>

          {/* Privacy Guarantee */}
          <div className="flex items-center gap-2 pt-2 text-[11px] text-[#3fb950] bg-[#238636]/10 border border-[#238636]/20 rounded-xl px-3.5 py-2.5">
            <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>100% Client-Side Privacy:</strong> Your token is sent strictly to <code className="text-white font-mono">api.github.com</code> directly from your browser. It is never logged, never transmitted to external servers, and never included in exported files.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
