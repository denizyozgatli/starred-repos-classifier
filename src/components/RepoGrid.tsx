import React from 'react';
import type { Repository } from '../types/repo.ts';
import { RepoCard } from './RepoCard.tsx';

interface RepoGridProps {
  repos: Repository[];
}

export const RepoGrid: React.FC<RepoGridProps> = ({ repos }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {repos.map(repo => (
        <RepoCard key={repo.id} repo={repo} />
      ))}
    </div>
  );
};
