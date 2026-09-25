import React from 'react';
import { Star, GitFork, Archive, ExternalLink } from 'lucide-react';
import type { Repository, RepositoryCategory } from '../types/repo.ts';

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

  return (
    <article
      className="group relative flex flex-col justify-between p-4 bg-[#161b22] border border-[#30363d] rounded-xl hover:border-[#58a6ff]/60 hover:shadow-lg transition-all duration-150"
    >
      <div>
        {/* Header: Owner / Name & External Link */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-base font-semibold leading-snug break-words">
            <a
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#58a6ff] hover:underline focus:outline-none focus:ring-1 focus:ring-[#58a6ff] rounded flex items-center gap-1.5"
            >
              <span>{repo.fullName}</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </a>
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {repo.archived && (
              <span
                title="Archived repository"
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded"
              >
                <Archive className="w-2.5 h-2.5" /> archived
              </span>
            )}
            {repo.fork && (
              <span
                title="Forked repository"
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded"
              >
                <GitFork className="w-2.5 h-2.5" /> fork
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-[#8b949e] line-clamp-2 mb-3 leading-relaxed">
          {repo.description || 'No description provided.'}
        </p>

        {/* Topics */}
        {repo.topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {repo.topics.slice(0, 4).map(topic => (
              <span
                key={topic}
                className="px-1.5 py-0.5 text-[10px] font-mono text-[#58a6ff] bg-[#1f6feb]/10 rounded hover:bg-[#1f6feb]/20 transition-colors"
              >
                {topic}
              </span>
            ))}
            {repo.topics.length > 4 && (
              <span className="text-[10px] text-github-muted self-center">
                +{repo.topics.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer: Metadata Badges */}
      <div className="flex items-center justify-between pt-3 border-t border-[#21262d] text-xs">
        <div className="flex items-center gap-2">
          {/* Category Badge */}
          <span
            className={`px-2 py-0.5 text-[11px] font-medium rounded-full border ${categoryStyle.bg} ${categoryStyle.text} ${categoryStyle.border}`}
          >
            {repo.category}
          </span>

          {/* Language */}
          {repo.language && (
            <span className="inline-flex items-center gap-1 text-[11px] text-github-muted">
              <span className="w-2 h-2 rounded-full bg-[#58a6ff]/80" />
              {repo.language}
            </span>
          )}
        </div>

        {/* Stars count & Updated date */}
        <div className="flex items-center gap-3 text-github-muted font-medium">
          <span className="text-[11px] text-github-muted font-normal">
            Updated {formatDate(repo.updatedAt)}
          </span>
          <div className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-[#e3b341] fill-[#e3b341]" />
            <span>{formatStars(repo.stars)}</span>
          </div>
        </div>
      </div>
    </article>
  );
};
