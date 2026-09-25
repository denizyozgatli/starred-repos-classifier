export interface RawGitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner?: {
    login: string;
  };
  description: string | null;
  topics?: string[];
  language: string | null;
  stargazers_count: number;
  html_url: string;
  updated_at: string;
  pushed_at?: string;
  archived?: boolean;
  fork?: boolean;
  [key: string]: unknown;
}

export interface NormalizedRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  url: string;
  updatedAt: string;
  archived: boolean;
  fork: boolean;
}

/**
 * Normalizes a raw GitHub repository API object into the internal pipeline format.
 * Keeps only relevant, useful fields and discards unnecessary API bloat.
 */
export function normalizeRepo(raw: RawGitHubRepo): NormalizedRepo {
  return {
    id: raw.id,
    name: raw.name || '',
    fullName: raw.full_name || `${raw.owner?.login || 'unknown'}/${raw.name || ''}`,
    owner: raw.owner?.login || raw.full_name?.split('/')[0] || 'unknown',
    description: raw.description ?? null,
    topics: Array.isArray(raw.topics) ? raw.topics.map(t => String(t).toLowerCase()) : [],
    language: raw.language ?? null,
    stars: typeof raw.stargazers_count === 'number' ? raw.stargazers_count : 0,
    url: raw.html_url || `https://github.com/${raw.full_name}`,
    updatedAt: raw.updated_at || raw.pushed_at || new Date().toISOString(),
    archived: Boolean(raw.archived),
    fork: Boolean(raw.fork),
  };
}
