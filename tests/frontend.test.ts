import { describe, it, expect } from 'vitest';
import type { Repository } from '../src/types/repo.ts';
import { searchRepositories } from '../src/lib/search.ts';
import { extractFilterOptions, filterRepositories } from '../src/lib/filters.ts';
import { sortRepositories } from '../src/lib/sorting.ts';
import { stateToQueryString, readStateFromUrl, type DashboardState } from '../src/lib/urlState.ts';

const SAMPLE_REPOS: Repository[] = [
  {
    id: 1,
    name: 'react',
    fullName: 'facebook/react',
    owner: 'facebook',
    description: 'The library for web and native user interfaces',
    topics: ['react', 'ui', 'frontend', 'declarative'],
    language: 'JavaScript',
    stars: 220000,
    url: 'https://github.com/facebook/react',
    updatedAt: '2026-03-01T00:00:00Z',
    category: 'Web Frontend',
    classification: {
      method: 'rule',
      confidence: 0.99,
      classifiedAt: '2026-03-01T00:00:00Z',
      inputHash: 'h1',
    },
  },
  {
    id: 2,
    name: 'fastapi',
    fullName: 'fastapi/fastapi',
    owner: 'fastapi',
    description: 'FastAPI framework, high performance, easy to learn, fast to code',
    topics: ['api', 'python', 'rest'],
    language: 'Python',
    stars: 80000,
    url: 'https://github.com/fastapi/fastapi',
    updatedAt: '2026-03-10T00:00:00Z',
    category: 'Backend / API',
    classification: {
      method: 'rule',
      confidence: 0.98,
      classifiedAt: '2026-03-10T00:00:00Z',
      inputHash: 'h2',
    },
  },
  {
    id: 3,
    name: 'kubernetes',
    fullName: 'kubernetes/kubernetes',
    owner: 'kubernetes',
    description: 'Production-Grade Container Scheduling and Management',
    topics: ['kubernetes', 'docker', 'containers'],
    language: 'Go',
    stars: 110000,
    url: 'https://github.com/kubernetes/kubernetes',
    updatedAt: '2026-03-15T00:00:00Z',
    category: 'DevOps / Infra',
    classification: {
      method: 'rule',
      confidence: 0.98,
      classifiedAt: '2026-03-15T00:00:00Z',
      inputHash: 'h3',
    },
  },
  {
    id: 4,
    name: 'transformers',
    fullName: 'huggingface/transformers',
    owner: 'huggingface',
    description: 'State-of-the-art Machine Learning for Pytorch and TensorFlow',
    topics: ['deep-learning', 'nlp', 'pytorch'],
    language: 'Python',
    stars: 135000,
    url: 'https://github.com/huggingface/transformers',
    updatedAt: '2026-03-20T00:00:00Z',
    category: 'ML / AI',
    classification: {
      method: 'rule',
      confidence: 0.99,
      classifiedAt: '2026-03-20T00:00:00Z',
      inputHash: 'h4',
    },
  },
];

describe('Frontend Logic', () => {
  describe('Fuse.js Search', () => {
    it('returns all repositories when search query is empty', () => {
      const results = searchRepositories(SAMPLE_REPOS, '');
      expect(results).toHaveLength(4);
    });

    it('searches across repository name', () => {
      const results = searchRepositories(SAMPLE_REPOS, 'fastapi');
      expect(results).toHaveLength(1);
      expect(results[0].fullName).toBe('fastapi/fastapi');
    });

    it('searches across description fuzzy matches', () => {
      const results = searchRepositories(SAMPLE_REPOS, 'container scheduling');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('kubernetes');
    });

    it('searches across topics', () => {
      const results = searchRepositories(SAMPLE_REPOS, 'declarative');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('react');
    });

    it('searches across owner', () => {
      const results = searchRepositories(SAMPLE_REPOS, 'huggingface');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('transformers');
    });
  });

  describe('Dynamic Filters', () => {
    it('extracts categories and languages dynamically without hardcoding', () => {
      const { categories, languages } = extractFilterOptions(SAMPLE_REPOS);

      expect(categories).toEqual(
        expect.arrayContaining([
          { value: 'Web Frontend', label: 'Web Frontend', count: 1 },
          { value: 'Backend / API', label: 'Backend / API', count: 1 },
          { value: 'DevOps / Infra', label: 'DevOps / Infra', count: 1 },
          { value: 'ML / AI', label: 'ML / AI', count: 1 },
        ])
      );

      // Python appears twice (fastapi and transformers)
      const pythonOption = languages.find(l => l.value === 'Python');
      expect(pythonOption).toEqual({ value: 'Python', label: 'Python', count: 2 });
    });

    it('filters by category', () => {
      const results = filterRepositories(SAMPLE_REPOS, ['DevOps / Infra'], []);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('kubernetes');
    });

    it('filters by language', () => {
      const results = filterRepositories(SAMPLE_REPOS, [], ['Python']);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.name)).toEqual(['fastapi', 'transformers']);
    });

    it('supports multi-category filtering (union)', () => {
      const results = filterRepositories(SAMPLE_REPOS, ['Web Frontend', 'ML / AI'], []);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.name)).toEqual(['react', 'transformers']);
    });

    it('supports intersecting category and language filters', () => {
      const results = filterRepositories(SAMPLE_REPOS, ['ML / AI'], ['Python']);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('transformers');

      // Zero match intersection
      const noMatch = filterRepositories(SAMPLE_REPOS, ['Web Frontend'], ['Python']);
      expect(noMatch).toHaveLength(0);
    });
  });

  describe('Sorting', () => {
    it('sorts by star count descending', () => {
      const sorted = sortRepositories(SAMPLE_REPOS, 'stars');
      expect(sorted.map(r => r.name)).toEqual(['react', 'transformers', 'kubernetes', 'fastapi']);
    });

    it('sorts by updated date descending', () => {
      const sorted = sortRepositories(SAMPLE_REPOS, 'updated');
      expect(sorted.map(r => r.name)).toEqual(['transformers', 'kubernetes', 'fastapi', 'react']);
    });

    it('sorts by name alphabetically', () => {
      const sorted = sortRepositories(SAMPLE_REPOS, 'name');
      expect(sorted.map(r => r.name)).toEqual(['fastapi', 'kubernetes', 'react', 'transformers']);
    });

    it('preserves order for relevance sort', () => {
      const sorted = sortRepositories(SAMPLE_REPOS, 'relevance');
      expect(sorted.map(r => r.name)).toEqual(['react', 'fastapi', 'kubernetes', 'transformers']);
    });
  });

  describe('URL State Serialization', () => {
    it('serializes state to query string correctly', () => {
      const state: DashboardState = {
        query: 'docker',
        categories: ['DevOps / Infra'],
        languages: ['Go'],
        sortBy: 'stars',
      };

      const qs = stateToQueryString(state);
      expect(qs).toContain('q=docker');
      expect(qs).toContain('category=DevOps+%2F+Infra');
      expect(qs).toContain('language=Go');
      expect(qs).toContain('sort=stars');
    });

    it('omits default values from query string for clean URLs', () => {
      const state: DashboardState = {
        query: '',
        categories: [],
        languages: [],
        sortBy: 'relevance',
      };

      const qs = stateToQueryString(state);
      expect(qs).toBe('');
    });

    it('falls back safely when window is undefined', () => {
      const state = readStateFromUrl();
      expect(state.query).toBe('');
      expect(state.categories).toEqual([]);
      expect(state.languages).toEqual([]);
      expect(state.sortBy).toBe('relevance');
    });
  });

  describe('Language Colors', () => {
    it('returns canonical colors for known languages', async () => {
      const { getLanguageColor } = await import('../src/lib/languageColors.ts');
      expect(getLanguageColor('Python')).toBe('#3572A5');
      expect(getLanguageColor('TypeScript')).toBe('#3178c6');
      expect(getLanguageColor('JavaScript')).toBe('#f1e05a');
      expect(getLanguageColor('Rust')).toBe('#dea584');
      expect(getLanguageColor('C#')).toBe('#178600');
      expect(getLanguageColor('HTML')).toBe('#e34c26');
      expect(getLanguageColor('Jupyter Notebook')).toBe('#DA5B0B');
    });

    it('falls back to neutral color for undefined or unknown language', async () => {
      const { getLanguageColor } = await import('../src/lib/languageColors.ts');
      expect(getLanguageColor(undefined)).toBe('#8b949e');
      expect(getLanguageColor(null)).toBe('#8b949e');
      expect(getLanguageColor('UnknownLangXYZ')).toBe('#8b949e');
    });
  });
});
