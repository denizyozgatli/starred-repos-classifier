import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { classifyRepos } from '../src/core/classify-repos.ts';
import { buildDatasetEnvelope, extractRepos } from '../src/core/dataset.ts';
import { parseAndValidateDataset, validateDataset } from '../src/lib/datasetValidation.ts';
import { executeDatasetPipeline } from '../scripts/lib/pipeline.ts';
import type { NormalizedRepo } from '../src/core/normalize.ts';
import type { Repository } from '../src/types/repo.ts';

const MOCK_NORMALIZED_REPOS: NormalizedRepo[] = [
  {
    id: 101,
    name: 'react-ui-tool',
    fullName: 'facebook/react-ui-tool',
    owner: 'facebook',
    description: 'A frontend interactive web application and visualizer',
    topics: ['web-app', 'frontend', 'ui'],
    language: 'TypeScript',
    stars: 1200,
    url: 'https://github.com/facebook/react-ui-tool',
    updatedAt: '2026-01-01T00:00:00Z',
    archived: false,
    fork: false,
  },
  {
    id: 102,
    name: 'ambiguous-unmatched-repo',
    fullName: 'anon/ambiguous-unmatched-repo',
    owner: 'anon',
    description: 'Misc random utility without strong domain tags',
    topics: [],
    language: null,
    stars: 5,
    url: 'https://github.com/anon/ambiguous-unmatched-repo',
    updatedAt: '2026-01-01T00:00:00Z',
    archived: false,
    fork: false,
  },
];

describe('Shared Core - classifyRepos', () => {
  it('cache hit reuses entry without reclassifying', async () => {
    const cachedEntry = {
      category: 'Web Frontend' as const,
      classification: {
        method: 'rule' as const,
        confidence: 0.99,
        classifiedAt: '2026-01-01T00:00:00Z',
        inputHash: 'pre-computed',
      },
    };

    // Calculate actual input hash for repo 101
    const { computeInputHash } = await import('../src/core/hash.ts');
    cachedEntry.classification.inputHash = computeInputHash(MOCK_NORMALIZED_REPOS[0]);

    const cache = {
      [MOCK_NORMALIZED_REPOS[0].fullName]: cachedEntry,
    };

    const result = await classifyRepos([MOCK_NORMALIZED_REPOS[0]], { cache });

    expect(result.cacheHits).toBe(1);
    expect(result.newlyClassified).toBe(0);
    expect(result.repos[0].category).toBe('Web Frontend');
    expect(result.repos[0].classification.classifiedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('reclassifies when inputHash changes (cache invalidation)', async () => {
    const staleCache = {
      [MOCK_NORMALIZED_REPOS[0].fullName]: {
        category: 'CLI / Tools' as const,
        classification: {
          method: 'manual' as const,
          confidence: 1.0,
          classifiedAt: '2025-01-01T00:00:00Z',
          inputHash: 'old-stale-hash',
        },
      },
    };

    const result = await classifyRepos([MOCK_NORMALIZED_REPOS[0]], {
      cache: staleCache,
      ruleOnly: true,
    });

    expect(result.cacheHits).toBe(0);
    expect(result.newlyClassified).toBe(1);
    expect(result.repos[0].category).toBe('Web Frontend');
    expect(result.repos[0].classification.inputHash).not.toBe('old-stale-hash');
  });

  it('ruleOnly with no rule match falls back to Other and is NOT added to cache', async () => {
    const cache = {};
    const result = await classifyRepos([MOCK_NORMALIZED_REPOS[1]], {
      cache,
      ruleOnly: true,
    });

    expect(result.cacheHits).toBe(0);
    expect(result.newlyClassified).toBe(1);
    expect(result.repos[0].category).toBe('Other');
    expect(result.repos[0].classification.method).toBe('fallback');
    expect(result.repos[0].classification.confidence).toBe(0.5);
    expect(result.cache[MOCK_NORMALIZED_REPOS[1].fullName]).toBeUndefined();
  });

  it('calls llmClassify only when ruleOnly=false and does NOT call it for cache hits', async () => {
    const { computeInputHash } = await import('../src/core/hash.ts');
    const validHash = computeInputHash(MOCK_NORMALIZED_REPOS[0]);

    const cache = {
      [MOCK_NORMALIZED_REPOS[0].fullName]: {
        category: 'Web Frontend' as const,
        classification: {
          method: 'rule' as const,
          confidence: 0.95,
          classifiedAt: '2026-01-01T00:00:00Z',
          inputHash: validHash,
        },
      },
    };

    const mockLlmClassify = vi.fn().mockResolvedValue({
      category: 'Security',
      method: 'llm',
      confidence: 0.88,
    });

    // 1. Process repoA (cache hit) -> mockLlmClassify must NOT be called
    await classifyRepos([MOCK_NORMALIZED_REPOS[0]], {
      cache,
      ruleOnly: false,
      llmClassify: mockLlmClassify,
    });
    expect(mockLlmClassify).not.toHaveBeenCalled();

    // 2. Process repoB (cache miss) with ruleOnly=true -> mockLlmClassify must NOT be called
    await classifyRepos([MOCK_NORMALIZED_REPOS[1]], {
      cache: {},
      ruleOnly: true,
      llmClassify: mockLlmClassify,
    });
    expect(mockLlmClassify).not.toHaveBeenCalled();

    // 3. Process repoB (cache miss) with ruleOnly=false -> mockLlmClassify MUST be called
    const res = await classifyRepos([MOCK_NORMALIZED_REPOS[1]], {
      cache: {},
      ruleOnly: false,
      llmClassify: mockLlmClassify,
    });
    expect(mockLlmClassify).toHaveBeenCalledTimes(1);
    expect(res.repos[0].category).toBe('Security');
    expect(res.repos[0].classification.method).toBe('llm');
  });

  it('calls onProgress for every processed repository', async () => {
    const progressSpy = vi.fn();
    await classifyRepos(MOCK_NORMALIZED_REPOS, {
      ruleOnly: true,
      onProgress: progressSpy,
    });

    expect(progressSpy).toHaveBeenCalledTimes(2);
    expect(progressSpy).toHaveBeenNthCalledWith(1, 1, 2, MOCK_NORMALIZED_REPOS[0]);
    expect(progressSpy).toHaveBeenNthCalledWith(2, 2, 2, MOCK_NORMALIZED_REPOS[1]);
  });

  it('aborts processing immediately when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      classifyRepos(MOCK_NORMALIZED_REPOS, {
        signal: controller.signal,
      })
    ).rejects.toThrow();
  });
});

describe('Shared Core - Dataset Envelope & Extract Repos', () => {
  const sampleRepo: Repository = {
    id: 999,
    name: 'test-repo',
    fullName: 'owner/test-repo',
    owner: 'owner',
    description: 'Test description',
    topics: ['test'],
    language: 'TypeScript',
    stars: 100,
    url: 'https://github.com/owner/test-repo',
    updatedAt: '2026-01-01T00:00:00Z',
    category: 'CLI / Tools',
    classification: {
      method: 'rule',
      confidence: 0.9,
      classifiedAt: '2026-01-01T00:00:00Z',
      inputHash: 'hash123',
    },
  };

  it('performs envelope roundtrip correctly', () => {
    const envelope = buildDatasetEnvelope([sampleRepo], {
      username: 'octocat',
      generatedAt: '2026-09-01T12:00:00Z',
    });

    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.username).toBe('octocat');
    expect(envelope.generatedAt).toBe('2026-09-01T12:00:00Z');
    expect(envelope.source).toEqual({
      type: 'github-stars',
      username: 'octocat',
    });
    expect(envelope.repos).toHaveLength(1);

    const extracted = extractRepos(envelope);
    expect(extracted).toEqual([sampleRepo]);
  });

  it('extracts repositories from legacy bare array', () => {
    const bareArray = [sampleRepo];
    const extracted = extractRepos(bareArray);
    expect(extracted).toEqual([sampleRepo]);
  });

  it('returns null for invalid inputs', () => {
    expect(extractRepos(null)).toBeNull();
    expect(extractRepos(undefined)).toBeNull();
    expect(extractRepos('string')).toBeNull();
    expect(extractRepos(42)).toBeNull();
    expect(extractRepos({})).toBeNull();
    expect(extractRepos({ repos: 'not-an-array' })).toBeNull();
    expect(extractRepos({ repos: null })).toBeNull();
  });
});

describe('Pipeline CheckUnchanged with Bare Array and Envelope Formats', () => {
  const testDir = resolve(tmpdir(), `pipeline-envelope-test-${Date.now()}`);
  const testOutput = resolve(testDir, 'repos.json');

  const mockRepos: NormalizedRepo[] = [
    {
      id: 501,
      name: 'sample',
      fullName: 'org/sample',
      owner: 'org',
      description: 'A sample tool',
      topics: ['cli'],
      language: 'Rust',
      stars: 50,
      url: 'https://github.com/org/sample',
      updatedAt: '2026-01-01T00:00:00Z',
      archived: false,
      fork: false,
    },
  ];

  afterEach(() => {
    if (existsSync(testOutput)) unlinkSync(testOutput);
  });

  it('detects unchanged dataset when existing file is legacy bare-array format', async () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    const mockClassifiedRepos: Repository[] = [
      {
        ...mockRepos[0],
        category: 'CLI / Tools',
        classification: {
          method: 'rule',
          confidence: 0.9,
          classifiedAt: '2026-01-01T00:00:00Z',
          inputHash: 'hash-sample',
        },
      },
    ];
    // Write legacy bare array
    writeFileSync(testOutput, JSON.stringify(mockClassifiedRepos), 'utf-8');

    const githubMod = await import('../scripts/lib/github.ts');
    const fetchSpy = vi.spyOn(githubMod, 'fetchAllStarredRepos').mockResolvedValue(mockRepos);

    try {
      const logs: string[] = [];
      const result = await executeDatasetPipeline({
        username: 'org',
        outputPath: testOutput,
        checkUnchanged: true,
        noCache: true,
        ruleOnly: true,
        logger: { log: (msg: string) => logs.push(msg), warn: () => {}, error: () => {} },
      });

      expect(result.unchanged).toBe(true);
      expect(logs).toContain('[pipeline] Upgraded legacy dataset file to envelope format');

      // Verify file was rewritten as envelope
      const rewritten = JSON.parse(readFileSync(testOutput, 'utf-8'));
      expect(rewritten.schemaVersion).toBe(1);
      expect(Array.isArray(rewritten.repos)).toBe(true);
      expect(rewritten.repos.length).toBe(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('detects unchanged dataset when existing file is envelope format (ignoring generatedAt)', async () => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    const mockClassifiedRepos: Repository[] = [
      {
        ...mockRepos[0],
        category: 'CLI / Tools',
        classification: {
          method: 'rule',
          confidence: 0.9,
          classifiedAt: '2026-01-01T00:00:00Z',
          inputHash: 'hash-sample',
        },
      },
    ];
    // Write envelope with older generatedAt
    const envelope = buildDatasetEnvelope(mockClassifiedRepos, {
      username: 'org',
      generatedAt: '2020-01-01T00:00:00Z',
    });
    writeFileSync(testOutput, JSON.stringify(envelope), 'utf-8');

    const githubMod = await import('../scripts/lib/github.ts');
    const fetchSpy = vi.spyOn(githubMod, 'fetchAllStarredRepos').mockResolvedValue(mockRepos);

    try {
      const logs: string[] = [];
      const result = await executeDatasetPipeline({
        username: 'org',
        outputPath: testOutput,
        checkUnchanged: true,
        noCache: true,
        ruleOnly: true,
        logger: { log: (msg: string) => logs.push(msg), warn: () => {}, error: () => {} },
      });

      expect(result.unchanged).toBe(true);
      expect(logs).not.toContain('[pipeline] Upgraded legacy dataset file to envelope format');

      // Verify file was NOT rewritten and generatedAt remains the original 2020 timestamp
      const notRewritten = JSON.parse(readFileSync(testOutput, 'utf-8'));
      expect(notRewritten.generatedAt).toBe('2020-01-01T00:00:00Z');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('Dataset Validation - Empty Dataset Handling', () => {
  it('accepts an empty array as valid with 0 repositories', () => {
    const result = parseAndValidateDataset('[]');
    expect(result.valid).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.metadata?.schemaVersion).toBe(1);
  });

  it('accepts an envelope with empty repos array as valid with 0 repositories', () => {
    const result = parseAndValidateDataset(JSON.stringify({ schemaVersion: 1, repos: [] }));
    expect(result.valid).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.metadata?.schemaVersion).toBe(1);
  });

  it('rejects an empty or whitespace-only string', () => {
    const emptyResult = parseAndValidateDataset('');
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.error).toBe('The uploaded file is empty.');

    const wsResult = parseAndValidateDataset('   \n  \t ');
    expect(wsResult.valid).toBe(false);
    expect(wsResult.error).toBe('The uploaded file is empty.');
  });

  it('directly validates empty array using validateDataset', () => {
    const directArrayResult = validateDataset([]);
    expect(directArrayResult.valid).toBe(true);
    expect(directArrayResult.data).toEqual([]);

    const directEnvelopeResult = validateDataset({ schemaVersion: 1, repos: [] });
    expect(directEnvelopeResult.valid).toBe(true);
    expect(directEnvelopeResult.data).toEqual([]);
  });
});
