import React from 'react';
import { Star, GitFork, Archive, ExternalLink } from 'lucide-react';
import type { Repository, RepositoryCategory } from '../types/repo.ts';
import { getLanguageColor } from '../lib/languageColors.ts';

interface RepoCardProps {
  repo: Repository;
}

const CATEGORY_STYLES: Record<RepositoryCategory, { bg: string; text: string; border: string }> = {
  'Web Frontend': { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  'Backend / API': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'DevOps / Infra': { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/30' },
  'ML / AI': { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30' },
  'Data Engineering': { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  'CLI / Tools': { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  'Learning / Docs': { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/30' },
  'Mobile': { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/30' },
  'Security': { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  'Other': { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/30' },
};

function formatStars(count: number): string {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return count.toString();
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export const RepoCard: React.FC<RepoCardProps> = ({ repo }) => {
  const categoryStyle = CATEGORY_STYLES[repo.category] || CATEGORY_STYLES['Other'];
  const languageColor = getLanguageColor(repo.language);

  return (
    <article
      className="group relative flex flex-col justify-between p-4 bg-[#161b22] border border-[#30363d] rounded-xl hover:border-[#8b949e]/50 hover:bg-[#161b22]/90 hover:shadow-md transition-all duration-150 focus-within:ring-2 focus-within:ring-[#58a6ff] focus-within:border-transparent cursor-pointer"
    >
      <div>
        {/* Header: Owner / Name & External Link & Badges */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-base leading-snug break-words">
            <a
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 focus:outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
              aria-label={`${repo.fullName} (opens in new tab)`}
            >
              <span className="text-[#8b949e] font-normal">{repo.owner}</span>
              <span className="text-[#8b949e] font-normal">/</span>
              <span className="text-white font-semibold group-hover:text-[#58a6ff] transition-colors">
                {repo.name}
              </span>
              <ExternalLink
                className="w-3.5 h-3.5 text-[#8b949e] group-hover:text-[#58a6ff] transition-colors shrink-0"
                aria-hidden="true"
              />
            </a>
          </h2>

          <div className="flex items-center gap-1 shrink-0 relative z-10 pointer-events-none">
            {repo.archived && (
              <span
                title="Archived repository"
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded select-none"
              >
                <Archive className="w-2.5 h-2.5" aria-hidden="true" /> archived
              </span>
            )}
            {repo.fork && (
              <span
                title="Forked repository"
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded select-none"
              >
                <GitFork className="w-2.5 h-2.5" aria-hidden="true" /> fork
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-[#8b949e] line-clamp-2 mb-3 leading-relaxed">
          {repo.description || 'No description provided.'}
        </p>

        {/* Topics (Clean non-interactive metadata badges) */}
        {repo.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3 select-none relative z-10 pointer-events-none">
            {repo.topics.slice(0, 4).map(topic => (
              <span
                key={topic}
                className="px-1.5 py-0.5 text-[10px] font-mono text-[#8b949e] bg-[#21262d] border border-[#30363d]/60 rounded"
              >
                #{topic}
              </span>
            ))}
            {repo.topics.length > 4 && (
              <span className="text-[10px] text-github-muted self-center font-mono">
                +{repo.topics.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer: Metadata Badges (Responsive Wrap Layout) */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 pt-3 border-t border-[#21262d] text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Category Badge */}
          <span
            className={`px-2 py-0.5 text-[11px] font-medium rounded-full border ${categoryStyle.bg} ${categoryStyle.text} ${categoryStyle.border}`}
          >
            {repo.category}
          </span>

          {/* Language with genuine GitHub Linguist color */}
          {repo.language && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-github-muted">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: languageColor }}
                aria-hidden="true"
              />
              <span>{repo.language}</span>
            </span>
          )}
        </div>

        {/* Stars count & Updated date */}
        <div className="flex items-center gap-2.5 text-github-muted ml-auto sm:ml-0">
          <span className="text-[11px] text-github-muted font-normal whitespace-nowrap">
            Updated {formatDate(repo.updatedAt)}
          </span>
          <div
            className="inline-flex items-center gap-1 font-medium text-white/90 bg-[#21262d] px-2 py-0.5 rounded border border-[#30363d] cursor-help"
            title={`${repo.stars.toLocaleString()} stars`}
            aria-label={`${repo.stars.toLocaleString()} stars`}
          >
            <Star className="w-3 h-3 text-[#e3b341] fill-[#e3b341]" aria-hidden="true" />
            <span className="text-[11px]">{formatStars(repo.stars)}</span>
          </div>
        </div>
      </div>
    </article>
  );
};
