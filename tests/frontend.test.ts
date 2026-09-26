import { describe, it, expect } from 'vitest';
import type { Repository } from '../src/types/repo.ts';
import { searchRepositories } from '../src/lib/search.ts';
import { extractFilterOptions, filterRepositories } from '../src/lib/filters.ts';
import { sortRepositories } from '../src/lib/sorting.ts';
import { stateToQueryString, readStateFromUrl, type DashboardState } from '../src/lib/urlState.ts';
import { parseAndValidateDataset, validateDataset } from '../src/lib/datasetValidation.ts';

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
    it('extracts categories, languages, and star lists dynamically without hardcoding', () => {
      const reposWithLists: Repository[] = [
        { ...SAMPLE_REPOS[0], lists: ['Favorites', 'Frontend Toolkit'] },
        { ...SAMPLE_REPOS[1], lists: ['Favorites', 'Backend Tools'] },
        { ...SAMPLE_REPOS[2], lists: [] },
        { ...SAMPLE_REPOS[3] },
      ];

      const { categories, languages, lists } = extractFilterOptions(reposWithLists);

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

      // Star lists extracted with accurate counts and sorted by count descending
      expect(lists).toEqual([
        { value: 'Favorites', label: 'Favorites', count: 2 },
        { value: 'Backend Tools', label: 'Backend Tools', count: 1 },
        { value: 'Frontend Toolkit', label: 'Frontend Toolkit', count: 1 },
      ]);
    });

    it('filters by star list', () => {
      const reposWithLists: Repository[] = [
        { ...SAMPLE_REPOS[0], lists: ['Favorites', 'Frontend Toolkit'] },
        { ...SAMPLE_REPOS[1], lists: ['Favorites', 'Backend Tools'] },
        { ...SAMPLE_REPOS[2], lists: [] },
        { ...SAMPLE_REPOS[3] },
      ];

      const favorites = filterRepositories(reposWithLists, [], [], 'Favorites');
      expect(favorites).toHaveLength(2);
      expect(favorites.map(r => r.name)).toEqual(['react', 'fastapi']);

      const backendOnly = filterRepositories(reposWithLists, [], [], 'Backend Tools');
      expect(backendOnly).toHaveLength(1);
      expect(backendOnly[0].name).toBe('fastapi');

      const nonExistent = filterRepositories(reposWithLists, [], [], 'Unknown List');
      expect(nonExistent).toHaveLength(0);
    });

    it('intersects star list filter with category and language filters', () => {
      const reposWithLists: Repository[] = [
        { ...SAMPLE_REPOS[0], lists: ['Favorites'] },
        { ...SAMPLE_REPOS[1], lists: ['Favorites'] },
        { ...SAMPLE_REPOS[2], lists: [] },
        { ...SAMPLE_REPOS[3], lists: ['Favorites'] },
      ];

      // Favorite repos that are Python: fastapi & transformers
      const favPython = filterRepositories(reposWithLists, [], ['Python'], 'Favorites');
      expect(favPython).toHaveLength(2);
      expect(favPython.map(r => r.name)).toEqual(['fastapi', 'transformers']);

      // Favorite repos in ML / AI and Python: transformers
      const favMlPython = filterRepositories(reposWithLists, ['ML / AI'], ['Python'], 'Favorites');
      expect(favMlPython).toHaveLength(1);
      expect(favMlPython[0].name).toBe('transformers');
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
        list: 'DevOps Tools',
        sortBy: 'stars',
      };

      const qs = stateToQueryString(state);
      expect(qs).toContain('q=docker');
      expect(qs).toContain('category=DevOps+%2F+Infra');
      expect(qs).toContain('language=Go');
      expect(qs).toContain('list=DevOps+Tools');
      expect(qs).toContain('sort=stars');
    });

    it('omits default values from query string for clean URLs', () => {
      const state: DashboardState = {
        query: '',
        categories: [],
        languages: [],
        list: null,
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
      expect(state.list).toBeNull();
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

  describe('Dataset Validation (P2.1 Local Import)', () => {
    it('successfully parses and validates a well-formed JSON dataset', () => {
      const json = JSON.stringify(SAMPLE_REPOS);
      const result = parseAndValidateDataset(json);

      expect(result.valid).toBe(true);
      expect(result.data).toHaveLength(SAMPLE_REPOS.length);
      expect(result.data?.[0].fullName).toBe('facebook/react');
    });

    it('rejects malformed JSON syntax with a helpful error', () => {
      const result = parseAndValidateDataset('{ invalid json content');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid JSON format');
    });

    it('rejects empty or whitespace-only files', () => {
      const resultEmpty = parseAndValidateDataset('');
      expect(resultEmpty.valid).toBe(false);
      expect(resultEmpty.error).toContain('file is empty');

      const resultWhitespace = parseAndValidateDataset('   \n  \t ');
      expect(resultWhitespace.valid).toBe(false);
      expect(resultWhitespace.error).toContain('file is empty');
    });

    it('rejects non-array JSON inputs', () => {
      const resultObject = parseAndValidateDataset(JSON.stringify({ repo: 'single' }));
      expect(resultObject.valid).toBe(false);
      expect(resultObject.error).toContain('must be a JSON array of repositories');

      const resultPrimitive = parseAndValidateDataset(JSON.stringify(12345));
      expect(resultPrimitive.valid).toBe(false);
      expect(resultPrimitive.error).toContain('must be a JSON array of repositories');
    });

    it('rejects an empty array of repositories', () => {
      const result = parseAndValidateDataset('[]');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('contains 0 repositories');
    });

    it('rejects items that are not objects', () => {
      const result = validateDataset(['string-item' as unknown as Repository]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not a valid repository object');
    });

    it('rejects missing or invalid required fields', () => {
      // Missing id
      const missingId = [{ ...SAMPLE_REPOS[0], id: undefined }];
      expect(validateDataset(missingId as unknown as Repository[]).valid).toBe(false);

      // Missing name
      const missingName = [{ ...SAMPLE_REPOS[0], name: '' }];
      expect(validateDataset(missingName as unknown as Repository[]).valid).toBe(false);

      // Invalid stars
      const negativeStars = [{ ...SAMPLE_REPOS[0], stars: -5 }];
      expect(validateDataset(negativeStars as unknown as Repository[]).valid).toBe(false);

      // Non-array topics
      const invalidTopics = [{ ...SAMPLE_REPOS[0], topics: 'not-array' }];
      expect(validateDataset(invalidTopics as unknown as Repository[]).valid).toBe(false);

      // Invalid URL
      const invalidUrl = [{ ...SAMPLE_REPOS[0], url: 'ftp://ftp.example.com' }];
      expect(validateDataset(invalidUrl as unknown as Repository[]).valid).toBe(false);

      // Invalid updatedAt date
      const invalidDate = [{ ...SAMPLE_REPOS[0], updatedAt: 'not-a-date' }];
      expect(validateDataset(invalidDate as unknown as Repository[]).valid).toBe(false);
    });

    it('rejects invalid or unknown repository categories', () => {
      const invalidCategory = [{ ...SAMPLE_REPOS[0], category: 'NonExistentCategory' }];
      const result = validateDataset(invalidCategory as unknown as Repository[]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid category');
    });

    it('rejects invalid classification object', () => {
      // Missing classification
      const missingClassification = [{ ...SAMPLE_REPOS[0], classification: undefined }];
      expect(validateDataset(missingClassification as unknown as Repository[]).valid).toBe(false);

      // Invalid classification method
      const invalidMethod = [{
        ...SAMPLE_REPOS[0],
        classification: { ...SAMPLE_REPOS[0].classification, method: 'unsupported-method' },
      }];
      expect(validateDataset(invalidMethod as unknown as Repository[]).valid).toBe(false);
    });

    it('rejects datasets with duplicate IDs or fullNames', () => {
      const duplicateIds = [
        SAMPLE_REPOS[0],
        { ...SAMPLE_REPOS[1], id: SAMPLE_REPOS[0].id },
      ];
      const resultId = validateDataset(duplicateIds);
      expect(resultId.valid).toBe(false);
      expect(resultId.error).toContain('Duplicate repository ID');

      const duplicateNames = [
        SAMPLE_REPOS[0],
        { ...SAMPLE_REPOS[1], id: 999, fullName: SAMPLE_REPOS[0].fullName },
      ];
      const resultName = validateDataset(duplicateNames);
      expect(resultName.valid).toBe(false);
      expect(resultName.error).toContain('Duplicate repository fullName');
    });

    it('validates optional star lists correctly', () => {
      // Valid string list names
      const withValidLists: Repository[] = [
        { ...SAMPLE_REPOS[0], lists: ['AI Research', 'Frontend Tools'] },
      ];
      const resultValid = validateDataset(withValidLists);
      expect(resultValid.valid).toBe(true);

      // Invalid list (non-string item)
      const withInvalidLists = [
        { ...SAMPLE_REPOS[0], lists: [123] },
      ];
      const resultInvalid = validateDataset(withInvalidLists as unknown as Repository[]);
      expect(resultInvalid.valid).toBe(false);
      expect(resultInvalid.error).toContain('must be an array of strings');
    });
  });
});
