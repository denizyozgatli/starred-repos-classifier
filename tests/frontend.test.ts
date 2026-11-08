import { describe, it, expect } from 'vitest';
import { CURRENT_SCHEMA_VERSION, type Repository, type DatasetEnvelope } from '../src/types/repo.ts';
import { searchRepositories } from '../src/lib/search.ts';
import { extractFilterOptions, filterRepositories, computeContextualFilterOptions } from '../src/lib/filters.ts';
import { sortRepositories } from '../src/lib/sorting.ts';
import { stateToQueryString, readStateFromUrl, type DashboardState } from '../src/lib/urlState.ts';
import { parseAndValidateDataset, validateDataset } from '../src/lib/datasetValidation.ts';
import { validateRepos } from '../scripts/lib/validator.ts';

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

    it('rejects non-array and invalid non-envelope JSON inputs', () => {
      const resultObject = parseAndValidateDataset(JSON.stringify({ repo: 'single' }));
      expect(resultObject.valid).toBe(false);
      expect(resultObject.error).toBeDefined();

      const resultPrimitive = parseAndValidateDataset(JSON.stringify(12345));
      expect(resultPrimitive.valid).toBe(false);
      expect(resultPrimitive.error).toBeDefined();
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

  describe('Contextual Faceted Filtering (P3 Filter Bug Fix)', () => {
    const FIXTURE_REPOS: Repository[] = [
      {
        id: 1,
        name: 'agent-core',
        fullName: 'org/agent-core',
        owner: 'org',
        description: 'Autonomous AI agent core engine',
        topics: ['ai', 'agent'],
        language: 'Python',
        stars: 1000,
        url: 'https://github.com/org/agent-core',
        updatedAt: '2026-03-01T00:00:00Z',
        category: 'ML / AI',
        lists: ['AI Tools', 'Starred Favorites'],
        classification: { method: 'rule', confidence: 0.99, classifiedAt: '2026-03-01T00:00:00Z', inputHash: 'h1' },
      },
      {
        id: 2,
        name: 'vision-llm',
        fullName: 'org/vision-llm',
        owner: 'org',
        description: 'Multimodal vision model toolkit',
        topics: ['vision', 'llm'],
        language: 'Python',
        stars: 800,
        url: 'https://github.com/org/vision-llm',
        updatedAt: '2026-03-02T00:00:00Z',
        category: 'ML / AI',
        lists: ['AI Tools'],
        classification: { method: 'rule', confidence: 0.99, classifiedAt: '2026-03-02T00:00:00Z', inputHash: 'h2' },
      },
      {
        id: 3,
        name: 'cli-agent',
        fullName: 'org/cli-agent',
        owner: 'org',
        description: 'Command line terminal agent tool',
        topics: ['cli', 'tools'],
        language: 'Go',
        stars: 500,
        url: 'https://github.com/org/cli-agent',
        updatedAt: '2026-03-03T00:00:00Z',
        category: 'CLI / Tools',
        lists: ['AI Tools'],
        classification: { method: 'rule', confidence: 0.95, classifiedAt: '2026-03-03T00:00:00Z', inputHash: 'h3' },
      },
      {
        id: 4,
        name: 'react-ui',
        fullName: 'org/react-ui',
        owner: 'org',
        description: 'React design system and components',
        topics: ['react', 'ui'],
        language: 'TypeScript',
        stars: 1200,
        url: 'https://github.com/org/react-ui',
        updatedAt: '2026-03-04T00:00:00Z',
        category: 'Web Frontend',
        lists: ['Web Stack'],
        classification: { method: 'rule', confidence: 0.98, classifiedAt: '2026-03-04T00:00:00Z', inputHash: 'h4' },
      },
      {
        id: 5,
        name: 'api-gateway',
        fullName: 'org/api-gateway',
        owner: 'org',
        description: 'High performance API gateway proxy',
        topics: ['api', 'gateway'],
        language: 'Go',
        stars: 600,
        url: 'https://github.com/org/api-gateway',
        updatedAt: '2026-03-05T00:00:00Z',
        category: 'Backend / API',
        lists: [],
        classification: { method: 'rule', confidence: 0.98, classifiedAt: '2026-03-05T00:00:00Z', inputHash: 'h5' },
      },
    ];

    it('1. No filters: Category and Star List counts represent complete dataset', () => {
      const facets = computeContextualFilterOptions(FIXTURE_REPOS, {});

      // Category counts: ML / AI (2), CLI / Tools (1), Web Frontend (1), Backend / API (1)
      const catMap = Object.fromEntries(facets.categories.map(c => [c.value, c.count]));
      expect(catMap).toEqual({
        'ML / AI': 2,
        'CLI / Tools': 1,
        'Web Frontend': 1,
        'Backend / API': 1,
      });

      // Star List counts: AI Tools (3), Starred Favorites (1), Web Stack (1)
      const listMap = Object.fromEntries(facets.lists.map(l => [l.value, l.count]));
      expect(listMap).toEqual({
        'AI Tools': 3,
        'Starred Favorites': 1,
        'Web Stack': 1,
      });

      // Language counts: Python (2), Go (2), TypeScript (1)
      const langMap = Object.fromEntries(facets.languages.map(l => [l.value, l.count]));
      expect(langMap).toEqual({
        'Python': 2,
        'Go': 2,
        'TypeScript': 1,
      });
    });

    it('2. Star List selected: Category counts calculated only from repositories in that Star List', () => {
      const facets = computeContextualFilterOptions(FIXTURE_REPOS, { selectedList: 'AI Tools' });

      // Categories present in 'AI Tools': ML / AI (2), CLI / Tools (1)
      const catMap = Object.fromEntries(facets.categories.map(c => [c.value, c.count]));
      expect(catMap).toEqual({
        'ML / AI': 2,
        'CLI / Tools': 1,
      });

      // Categories with zero matching repos ('Web Frontend', 'Backend / API') are absent
      expect(facets.categories.some(c => c.value === 'Web Frontend')).toBe(false);
      expect(facets.categories.some(c => c.value === 'Backend / API')).toBe(false);

      // Selecting any displayed category produces non-zero results matching the displayed count
      for (const cat of facets.categories) {
        const matches = filterRepositories(FIXTURE_REPOS, [cat.value], [], 'AI Tools');
        expect(matches.length).toBe(cat.count);
        expect(matches.length).toBeGreaterThan(0);
      }
    });

    it('3. Category selected: Star List counts calculated only from repositories in that Category', () => {
      const facets = computeContextualFilterOptions(FIXTURE_REPOS, { selectedCategories: ['ML / AI'] });

      // Star Lists present in 'ML / AI': AI Tools (2), Starred Favorites (1)
      const listMap = Object.fromEntries(facets.lists.map(l => [l.value, l.count]));
      expect(listMap).toEqual({
        'AI Tools': 2,
        'Starred Favorites': 1,
      });

      // Lists with zero matching repos ('Web Stack') are absent
      expect(facets.lists.some(l => l.value === 'Web Stack')).toBe(false);

      // Selecting any displayed list produces non-zero results matching the displayed count
      for (const list of facets.lists) {
        const matches = filterRepositories(FIXTURE_REPOS, ['ML / AI'], [], list.value);
        expect(matches.length).toBe(list.count);
        expect(matches.length).toBeGreaterThan(0);
      }
    });

    it('4. Star List + Category: result set is intersection and counts remain consistent', () => {
      const filtered = filterRepositories(FIXTURE_REPOS, ['ML / AI'], [], 'AI Tools');
      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.name)).toEqual(['agent-core', 'vision-llm']);

      const facets = computeContextualFilterOptions(FIXTURE_REPOS, {
        selectedList: 'AI Tools',
        selectedCategories: ['ML / AI'],
      });

      // In the context of 'AI Tools', Category facet shows available categories within 'AI Tools'
      const catMap = Object.fromEntries(facets.categories.map(c => [c.value, c.count]));
      expect(catMap).toEqual({
        'ML / AI': 2,
        'CLI / Tools': 1,
      });

      // In the context of 'ML / AI', Star List facet shows available lists within 'ML / AI'
      const listMap = Object.fromEntries(facets.lists.map(l => [l.value, l.count]));
      expect(listMap).toEqual({
        'AI Tools': 2,
        'Starred Favorites': 1,
      });
    });

    it('5. Search + Star List: search semantics preserved in contextual counts and results', () => {
      const searched = searchRepositories(FIXTURE_REPOS, 'agent');
      expect(searched.map(r => r.name)).toEqual(expect.arrayContaining(['agent-core', 'cli-agent']));

      const facets = computeContextualFilterOptions(searched, { selectedList: 'AI Tools' });
      const catMap = Object.fromEntries(facets.categories.map(c => [c.value, c.count]));
      expect(catMap).toEqual({
        'ML / AI': 1,
        'CLI / Tools': 1,
      });

      const filtered = filterRepositories(searched, [], [], 'AI Tools');
      expect(filtered).toHaveLength(2);
      expect(filtered.map(r => r.name)).toEqual(expect.arrayContaining(['agent-core', 'cli-agent']));
    });

    it('6. Search + Category: search semantics preserved in contextual counts and results', () => {
      const searched = searchRepositories(FIXTURE_REPOS, 'agent');
      const facets = computeContextualFilterOptions(searched, { selectedCategories: ['ML / AI'] });

      // In searched repos matching 'ML / AI', only agent-core matches
      const listMap = Object.fromEntries(facets.lists.map(l => [l.value, l.count]));
      expect(listMap).toEqual({
        'AI Tools': 1,
        'Starred Favorites': 1,
      });

      const filtered = filterRepositories(searched, ['ML / AI'], []);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('agent-core');
    });

    it('7. URL state: serializes and restores category and list parameters', () => {
      const state: DashboardState = {
        query: 'agent',
        categories: ['ML / AI'],
        languages: ['Python'],
        sortBy: 'stars',
        list: 'AI Tools',
      };

      const queryString = stateToQueryString(state);
      expect(queryString).toContain('category=ML+%2F+AI');
      expect(queryString).toContain('list=AI+Tools');

      // Emulate URLSearchParams parse
      const params = new URLSearchParams(queryString.slice(1));
      expect(params.get('category')).toBe('ML / AI');
      expect(params.get('list')).toBe('AI Tools');
    });

    it('8. Reset: clearing active filters restores full dataset facet counts', () => {
      // Filtered state
      const filteredFacets = computeContextualFilterOptions(FIXTURE_REPOS, { selectedList: 'AI Tools' });
      expect(filteredFacets.categories).toHaveLength(2);

      // Reset state (all filter params empty/null)
      const resetFacets = computeContextualFilterOptions(FIXTURE_REPOS, {
        selectedCategories: [],
        selectedLanguages: [],
        selectedList: null,
      });

      expect(resetFacets.categories).toHaveLength(4);
      expect(resetFacets.lists).toHaveLength(3);
    });

    it('9. Empty intersection: gracefully handles zero-result combinations from external URLs', () => {
      // Incompatible combination: 'Web Stack' (only react-ui in Web Frontend) + 'ML / AI'
      const filtered = filterRepositories(FIXTURE_REPOS, ['ML / AI'], [], 'Web Stack');
      expect(filtered).toHaveLength(0);

      const facets = computeContextualFilterOptions(FIXTURE_REPOS, {
        selectedList: 'Web Stack',
        selectedCategories: ['ML / AI'],
      });

      // Categories within 'Web Stack'
      expect(facets.categories.map(c => c.value)).toEqual(['Web Frontend']);
      // Lists within 'ML / AI'
      expect(facets.lists.map(l => l.value)).toEqual(expect.arrayContaining(['AI Tools', 'Starred Favorites']));
    });
  });

  describe('P3.2 - Dataset Schema & Versioning', () => {
    it('accepts legacy Repository[] bare array and normalizes as schema version 1', () => {
      const result = validateDataset(SAMPLE_REPOS);
      expect(result.valid).toBe(true);
      expect(result.data).toHaveLength(SAMPLE_REPOS.length);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('accepts a valid schema v1 envelope', () => {
      const envelope: DatasetEnvelope = {
        schemaVersion: 1,
        repos: SAMPLE_REPOS,
      };
      const result = validateDataset(envelope);
      expect(result.valid).toBe(true);
      expect(result.data).toHaveLength(SAMPLE_REPOS.length);
      expect(result.metadata?.schemaVersion).toBe(1);
    });

    it('preserves optional metadata fields (username, generatedAt, source) in envelope', () => {
      const envelope: DatasetEnvelope = {
        schemaVersion: 1,
        username: 'alice',
        generatedAt: '2026-09-26T12:00:00.000Z',
        source: {
          type: 'github-stars',
          username: 'alice',
        },
        repos: SAMPLE_REPOS,
      };
      const result = validateDataset(envelope);
      expect(result.valid).toBe(true);
      expect(result.metadata?.username).toBe('alice');
      expect(result.metadata?.generatedAt).toBe('2026-09-26T12:00:00.000Z');
      expect(result.metadata?.source).toEqual({ type: 'github-stars', username: 'alice' });
    });

    it('validates envelope repositories using existing repository-level rules', () => {
      const invalidEnvelope = {
        schemaVersion: 1,
        repos: [
          {
            ...SAMPLE_REPOS[0],
            stars: -10, // Invalid negative stars
          },
        ],
      };
      const result = validateDataset(invalidEnvelope);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('has invalid "stars"');
    });

    it('rejects an envelope missing a valid repos array', () => {
      // Missing repos field
      const missingRepos = { schemaVersion: 1 };
      const resultMissing = validateDataset(missingRepos);
      expect(resultMissing.valid).toBe(false);
      expect(resultMissing.error).toContain('missing a valid "repos" array');

      // repos is not an array
      const nonArrayRepos = { schemaVersion: 1, repos: 'not-an-array' };
      const resultNonArray = validateDataset(nonArrayRepos);
      expect(resultNonArray.valid).toBe(false);
      expect(resultNonArray.error).toContain('missing a valid "repos" array');
    });

    it('accepts an envelope with an empty repos array as structurally valid', () => {
      const emptyEnvelope = { schemaVersion: 1, repos: [] };
      const result = validateDataset(emptyEnvelope);
      expect(result.valid).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.metadata?.schemaVersion).toBe(1);
    });

    it('rejects an envelope with invalid or non-integer schemaVersion types', () => {
      // String version
      const stringVersion = { schemaVersion: '1', repos: SAMPLE_REPOS };
      const resultString = validateDataset(stringVersion);
      expect(resultString.valid).toBe(false);
      expect(resultString.error).toContain('Invalid "schemaVersion": must be an integer');

      // Float version
      const floatVersion = { schemaVersion: 1.5, repos: SAMPLE_REPOS };
      const resultFloat = validateDataset(floatVersion);
      expect(resultFloat.valid).toBe(false);
      expect(resultFloat.error).toContain('Invalid "schemaVersion": must be an integer');

      // Missing version
      const missingVersion = { repos: SAMPLE_REPOS };
      const resultMissing = validateDataset(missingVersion);
      expect(resultMissing.valid).toBe(false);
      expect(resultMissing.error).toContain('Dataset envelope is missing "schemaVersion"');
    });

    it('accepts an integer schemaVersion <= CURRENT_SCHEMA_VERSION without arbitrary positive-only restriction', () => {
      const zeroVersion = { schemaVersion: 0, repos: SAMPLE_REPOS };
      const resultZero = validateDataset(zeroVersion);
      expect(resultZero.valid).toBe(true);
      expect(resultZero.metadata?.schemaVersion).toBe(0);
    });

    it('rejects unsupported future schema versions with clear upgrade message', () => {
      const futureEnvelope = { schemaVersion: 2, repos: SAMPLE_REPOS };
      const result = validateDataset(futureEnvelope);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported dataset schema version (2)');
      expect(result.error).toContain('This version supports schema version 1');
    });

    it('verifies pipeline validator (validateRepos) accepts bare array, valid envelope, and empty repos envelope', () => {
      // 1. Bare array
      const arrayResult = validateRepos(SAMPLE_REPOS);
      expect(arrayResult.valid).toBe(true);
      expect(arrayResult.errors).toHaveLength(0);

      // 2. Envelope
      const envelopeResult = validateRepos({
        schemaVersion: 1,
        username: 'pipeline-user',
        repos: SAMPLE_REPOS,
      });
      expect(envelopeResult.valid).toBe(true);
      expect(envelopeResult.errors).toHaveLength(0);

      // 3. Envelope with empty repos array
      const emptyEnvelopeResult = validateRepos({
        schemaVersion: 1,
        repos: [],
      });
      expect(emptyEnvelopeResult.valid).toBe(true);
      expect(emptyEnvelopeResult.errors).toHaveLength(0);

      // 4. Unsupported version
      const futureResult = validateRepos({
        schemaVersion: 99,
        repos: SAMPLE_REPOS,
      });
      expect(futureResult.valid).toBe(false);
      expect(futureResult.errors[0].message).toContain('Unsupported dataset schema version (99)');
    });
  });

  describe('Decoupled Architecture & Empty Initial State Support', () => {
    it('gracefully handles empty initial dataset in search, filtering, and sorting pipelines', () => {
      const emptyRepos: Repository[] = [];

      // 1. Search returns empty
      const searchResult = searchRepositories(emptyRepos, 'react');
      expect(searchResult).toEqual([]);

      // 2. Filter options on empty repos
      const options = computeContextualFilterOptions(emptyRepos, {
        selectedCategories: [],
        selectedLanguages: [],
        selectedList: null,
      });
      expect(options.categories).toEqual([]);
      expect(options.languages).toEqual([]);
      expect(options.lists).toEqual([]);

      // 3. Filter on empty repos
      const filtered = filterRepositories(emptyRepos, ['Web Frontend'], ['TypeScript'], null);
      expect(filtered).toEqual([]);

      // 4. Sort on empty repos
      const sorted = sortRepositories(emptyRepos, 'stars');
      expect(sorted).toEqual([]);
    });

    it('extracts metadata correctly when importing a user-provided dataset envelope', () => {
      const userEnvelope: DatasetEnvelope = {
        schemaVersion: 1,
        username: 'alice-developer',
        generatedAt: '2026-09-26T15:00:00.000Z',
        source: {
          type: 'github-stars',
          username: 'alice-developer',
        },
        repos: SAMPLE_REPOS,
      };

      const result = parseAndValidateDataset(JSON.stringify(userEnvelope));
      expect(result.valid).toBe(true);
      expect(result.data).toHaveLength(SAMPLE_REPOS.length);
      expect(result.metadata?.schemaVersion).toBe(1);
      expect(result.metadata?.username).toBe('alice-developer');
      expect(result.metadata?.generatedAt).toBe('2026-09-26T15:00:00.000Z');
      expect(result.metadata?.source?.type).toBe('github-stars');
      expect(result.metadata?.source?.username).toBe('alice-developer');
    });

    it('validates an imported empty dataset envelope for empty state display', () => {
      const emptyUserEnvelope: DatasetEnvelope = {
        schemaVersion: 1,
        username: 'newbie-coder',
        repos: [],
      };

      const result = parseAndValidateDataset(JSON.stringify(emptyUserEnvelope));
      expect(result.valid).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.metadata?.username).toBe('newbie-coder');
    });
  });
});
