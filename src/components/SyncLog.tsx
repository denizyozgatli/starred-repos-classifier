import React, { useRef, useEffect } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import type { ActivityLogEntry } from '../lib/activityLog.ts';

export interface SyncLogProps {
  entries: ReadonlyArray<ActivityLogEntry>;
  onClear?: () => void;
  defaultOpen?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const SyncLog: React.FC<SyncLogProps> = ({
  entries,
  onClear,
  defaultOpen = false,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <details
      className="group border border-[#30363d] rounded-xl bg-[#0d1117]/60 overflow-hidden text-left"
      open={defaultOpen}
    >
      <summary className="flex items-center justify-between px-3 py-2 text-xs font-medium text-github-muted hover:text-white cursor-pointer select-none transition-colors">
        <span className="font-semibold text-white/90">
          {`Activity (${entries.length})`}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-github-muted transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-[#30363d]/60 p-2.5 space-y-2 bg-[#0d1117]">
        <div className="flex items-center justify-between text-[11px] text-github-muted pb-1 border-b border-[#30363d]/40">
          <span>Recent activity</span>
          {onClear && (
            <button
              type="button"
              onClick={e => {
                e.preventDefault();
                onClear();
              }}
              className="inline-flex items-center gap-1 text-[11px] text-github-muted hover:text-[#ff7b72] transition-colors cursor-pointer"
              title="Clear activity log"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        <div
          ref={listRef}
          className="max-h-[200px] overflow-y-auto space-y-1 font-mono text-[11px] pr-1 leading-relaxed"
          tabIndex={0}
          role="region"
          aria-label="Activity Log Entries"
        >
          {entries.length === 0 ? (
            <p className="text-github-muted py-2 text-center text-xs font-sans">
              No activity recorded yet.
            </p>
          ) : (
            entries.map((entry, idx) => {
              let colorClass = 'text-[#c9d1d9]';
              if (entry.kind === 'warn') {
                colorClass = 'text-[#e3b341]';
              } else if (entry.kind === 'error') {
                colorClass = 'text-[#ff7b72]';
              } else if (entry.kind === 'success') {
                colorClass = 'text-[#3fb950]';
              }

              return (
                <div key={idx} className={`break-words ${colorClass}`}>
                  <span className="text-github-muted select-none mr-2">
                    {formatTime(entry.ts)}
                  </span>
                  <span>{entry.text}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </details>
  );
};
