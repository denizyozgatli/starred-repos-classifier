import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeRepo, type RawGitHubRepo } from '../scripts/lib/normalize.ts';
import { classifyWithRules } from '../scripts/lib/classifier.ts';
import { computeInputHash } from '../scripts/lib/cache.ts';
import { applyOverrides } from '../scripts/lib/overrides.ts';
import { validateRepos } from '../scripts/lib/validator.ts';
import { fetchAllStarredRepos, GitHubApiError } from '../scripts/lib/github.ts';
import { atomicWriteJson, withDatasetSafety } from '../scripts/lib/storage.ts';
import { runClassification } from '../scripts/classify.ts';
import type { Repository } from '../src/types/repo.ts';

describe('Data Pipeline', () => {
  describe('Normalization', () => {
    it('normalizes raw GitHub repo API response to internal format', () => {
      const raw: RawGitHubRepo = {
        id: 12345,
        name: 'my-app',
        full_name: 'testowner/my-app',
        owner: { login: 'testowner' },
        description: 'A test project for web frontend',
        topics: ['React', 'TypeScript', 'UI'],
        language: 'TypeScript',
        stargazers_count: 450,
        html_url: 'https://github.com/testowner/my-app',
        updated_at: '2026-01-01T00:00:00Z',
        archived: false,
        fork: false,
      };

      const normalized = normalizeRepo(raw);
      expect(normalized).toEqual({
        id: 12345,
        name: 'my-app',
        fullName: 'testowner/my-app',
        owner: 'testowner',
        description: 'A test project for web frontend',
        topics: ['react', 'typescript', 'ui'],
        language: 'TypeScript',
        stars: 450,
        url: 'https://github.com/testowner/my-app',
        updatedAt: '2026-01-01T00:00:00Z',
        archived: false,
        fork: false,
      });
    });

    it('handles missing optional fields cleanly', () => {
      const raw: RawGitHubRepo = {
        id: 999,
        name: 'simple',
        full_name: 'anon/simple',
        stargazers_count: 0,
        html_url: 'https://github.com/anon/simple',
        updated_at: '2026-01-01T00:00:00Z',
        description: null,
        language: null,
      };

      const normalized = normalizeRepo(raw);
      expect(normalized.owner).toBe('anon');
      expect(normalized.description).toBeNull();
      expect(normalized.topics).toEqual([]);
      expect(normalized.language).toBeNull();
      expect(normalized.stars).toBe(0);
      expect(normalized.archived).toBe(false);
      expect(normalized.fork).toBe(false);
    });
  });

  describe('Rule-Based Classification', () => {
    it('correctly classifies web frontend repositories', () => {
      const repo = normalizeRepo({
        id: 1,
        name: 'nextjs-dashboard',
        full_name: 'user/nextjs-dashboard',
        description: 'Modern UI built with React and Tailwind CSS',
        topics: ['react', 'tailwindcss', 'frontend'],
        language: 'TypeScript',
        stargazers_count: 100,
        html_url: 'https://github.com/user/nextjs-dashboard',
        updated_at: '2026-01-01T00:00:00Z',
      });

      const res = classifyWithRules(repo);
      expect(res).not.toBeNull();
      expect(res?.category).toBe('Web Frontend');
      expect(res?.method).toBe('rule');
    });

    it('correctly classifies machine learning repositories', () => {
      const repo = normalizeRepo({
        id: 2,
        name: 'llm-finetuner',
        full_name: 'user/llm-finetuner',
        description: 'Fine-tune large language models with PyTorch',
        topics: ['pytorch', 'llm', 'deep-learning'],
        language: 'Python',
        stargazers_count: 500,
        html_url: 'https://github.com/user/llm-finetuner',
        updated_at: '2026-01-01T00:00:00Z',
      });

      const res = classifyWithRules(repo);
      expect(res?.category).toBe('ML / AI');
    });

    it('correctly classifies devops & infra repositories', () => {
      const repo = normalizeRepo({
        id: 3,
        name: 'k8s-operator',
        full_name: 'user/k8s-operator',
        description: 'Kubernetes custom resource controller for deployments',
        topics: ['kubernetes', 'docker', 'helm'],
        language: 'Go',
        stargazers_count: 300,
        html_url: 'https://github.com/user/k8s-operator',
        updated_at: '2026-01-01T00:00:00Z',
      });

      const res = classifyWithRules(repo);
      expect(res?.category).toBe('DevOps / Infra');
    });

    it('returns null for ambiguous repositories without clear signals', () => {
      const repo = normalizeRepo({
        id: 4,
        name: 'project-x',
        full_name: 'user/project-x',
        description: 'Random experiment project',
        topics: [],
        language: 'C++',
        stargazers_count: 5,
        html_url: 'https://github.com/user/project-x',
        updated_at: '2026-01-01T00:00:00Z',
      });

      const res = classifyWithRules(repo);
      expect(res).toBeNull();
    });
  });

  describe('Classification Cache', () => {
    it('produces deterministic hash regardless of topic ordering', () => {
      const repoA = {
        fullName: 'owner/repo',
        description: 'Sample description',
        topics: ['web', 'react', 'api'],
        language: 'TypeScript',
      };

      const repoB = {
        fullName: 'owner/repo',
        description: 'Sample description',
        topics: ['api', 'react', 'web'],
        language: 'TypeScript',
      };

      const hashA = computeInputHash(repoA);
      const hashB = computeInputHash(repoB);
      expect(hashA).toBe(hashB);
    });

    it('changes hash when description or topics change', () => {
      const repoA = {
        fullName: 'owner/repo',
        description: 'Original description',
        topics: ['web'],
        language: 'TypeScript',
      };

      const repoB = {
        fullName: 'owner/repo',
        description: 'Updated description',
        topics: ['web'],
        language: 'TypeScript',
      };

      expect(computeInputHash(repoA)).not.toBe(computeInputHash(repoB));
    });
  });

  describe('Manual Overrides', () => {
    it('overrides category and updates metadata with manual method', () => {
      const repos: Repository[] = [
        {
          id: 1,
          name: 'cli-tool',
          fullName: 'owner/cli-tool',
          owner: 'owner',
          description: 'A tool',
          topics: ['cli'],
          language: 'Rust',
          stars: 10,
          url: 'https://github.com/owner/cli-tool',
          updatedAt: '2026-01-01T00:00:00Z',
          category: 'CLI / Tools',
          classification: {
            method: 'rule',
            confidence: 0.9,
            classifiedAt: '2026-01-01T00:00:00Z',
            inputHash: 'hash1',
          },
        },
      ];

      const overrides = {
        'owner/cli-tool': { category: 'Security' as const },
      };

      const result = applyOverrides(repos, overrides);
      expect(result[0].category).toBe('Security');
      expect(result[0].classification.method).toBe('manual');
      expect(result[0].classification.confidence).toBe(1.0);
    });

    it('leaves non-overridden repos untouched', () => {
      const repos: Repository[] = [
        {
          id: 2,
          name: 'other',
          fullName: 'owner/other',
          owner: 'owner',
          description: null,
          topics: [],
          language: null,
          stars: 5,
          url: 'https://github.com/owner/other',
          updatedAt: '2026-01-01T00:00:00Z',
          category: 'Other',
          classification: {
            method: 'rule',
            confidence: 0.5,
            classifiedAt: '2026-01-01T00:00:00Z',
            inputHash: 'hash2',
          },
        },
      ];

      const result = applyOverrides(repos, {});
      expect(result[0].category).toBe('Other');
      expect(result[0].classification.method).toBe('rule');
    });
  });

  describe('Schema Validation', () => {
    const validRepo: Repository = {
      id: 101,
      name: 'valid-repo',
      fullName: 'owner/valid-repo',
      owner: 'owner',
      description: 'A valid repo',
      topics: ['topic1'],
      language: 'Go',
      stars: 150,
      url: 'https://github.com/owner/valid-repo',
      updatedAt: '2026-01-01T12:00:00Z',
      category: 'Backend / API',
      classification: {
        method: 'rule',
        confidence: 0.95,
        classifiedAt: '2026-01-01T12:00:00Z',
        inputHash: 'hash101',
      },
    };

    it('validates a correct repository list', () => {
      const res = validateRepos([validRepo]);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('detects duplicate repository IDs', () => {
      const duplicateIdRepo = { ...validRepo, fullName: 'owner/other-repo' };
      const res = validateRepos([validRepo, duplicateIdRepo]);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.message.includes('Duplicate repository ID'))).toBe(true);
    });

    it('detects duplicate repository fullNames', () => {
      const duplicateNameRepo = { ...validRepo, id: 102 };
      const res = validateRepos([validRepo, duplicateNameRepo]);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.message.includes('Duplicate repository fullName'))).toBe(true);
    });

    it('rejects invalid category', () => {
      const invalidCatRepo = { ...validRepo, category: 'Invalid Category' as any };
      const res = validateRepos([invalidCatRepo]);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.field === 'category')).toBe(true);
    });

    it('rejects invalid URL', () => {
      const invalidUrlRepo = { ...validRepo, url: 'not-a-valid-url' };
      const res = validateRepos([invalidUrlRepo]);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.field === 'url')).toBe(true);
    });
  });

  describe('Pagination & GitHub API Failure Behavior', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('throws when GITHUB_TOKEN is missing', async () => {
      delete process.env.GITHUB_TOKEN;
      await expect(fetchAllStarredRepos({ token: '' })).rejects.toThrow('GitHub token is required');
    });

    it('handles multiple pages until all pages are retrieved', async () => {
      let callCount = 0;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        callCount++;
        const url = String(input);
        if (url.includes('page=1')) {
          // Page 1: returns 2 items with perPage=2
          return new Response(
            JSON.stringify([
              { id: 1, name: 'r1', full_name: 'o/r1', stargazers_count: 10, html_url: 'https://github.com/o/r1', updated_at: '2026-01-01T00:00:00Z' },
              { id: 2, name: 'r2', full_name: 'o/r2', stargazers_count: 20, html_url: 'https://github.com/o/r2', updated_at: '2026-01-01T00:00:00Z' },
            ]),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json', link: '<https://api.github.com/user/starred?per_page=2&page=2>; rel="next"' },
            }
          );
        } else {
          // Page 2: returns 1 item, less than perPage=2
          return new Response(
            JSON.stringify([
              { id: 3, name: 'r3', full_name: 'o/r3', stargazers_count: 30, html_url: 'https://github.com/o/r3', updated_at: '2026-01-01T00:00:00Z' },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      };

      const repos = await fetchAllStarredRepos({ token: 'test-token', perPage: 2 });
      expect(repos).toHaveLength(3);
      expect(callCount).toBe(2);
      expect(repos.map(r => r.id)).toEqual([1, 2, 3]);
    });

    it('handles 401 invalid token with clear error', async () => {
      globalThis.fetch = async () => {
        return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
      };

      await expect(fetchAllStarredRepos({ token: 'bad-token' })).rejects.toThrow(GitHubApiError);
    });

    it('handles rate limiting (403/429) safely with reset time', async () => {
      globalThis.fetch = async () => {
        return new Response('Rate limit', {
          status: 403,
          statusText: 'Forbidden',
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1800000000',
          },
        });
      };

      await expect(fetchAllStarredRepos({ token: 'test-token' })).rejects.toThrow('rate limit exceeded');
    });
  });

  describe('Atomic Dataset Safety & Crash Rollback', () => {
    const testDataDir = resolve(process.cwd(), 'data');
    const testTarget = resolve(testDataDir, 'test-repos.json');
    const testBackup = resolve(testDataDir, 'test-repos.backup.json');
    const testRaw = resolve(testDataDir, 'test-raw.json');

    const validInitialData = [
      {
        id: 777,
        name: 'vital-repo',
        fullName: 'owner/vital-repo',
        owner: 'owner',
        description: 'Crucial repository data',
        topics: ['important'],
        language: 'TypeScript',
        stars: 100,
        url: 'https://github.com/owner/vital-repo',
        updatedAt: '2026-01-01T00:00:00Z',
        category: 'Web Frontend',
        classification: {
          method: 'rule',
          confidence: 0.95,
          classifiedAt: '2026-01-01T00:00:00Z',
          inputHash: 'hash-vital',
        },
      },
    ];

    afterEach(() => {
      [testTarget, testBackup, testRaw].forEach(p => {
        if (existsSync(p)) {
          try { unlinkSync(p); } catch { /* ignore */ }
        }
      });
    });

    it('performs atomic write replacing target file cleanly', () => {
      atomicWriteJson(testTarget, validInitialData);
      expect(existsSync(testTarget)).toBe(true);

      const parsed = JSON.parse(readFileSync(testTarget, 'utf-8'));
      expect(parsed).toEqual(validInitialData);
    });

    it('restores original valid dataset if an operation fails or crashes', async () => {
      // 1. Establish existing valid dataset
      atomicWriteJson(testTarget, validInitialData);

      // 2. Trigger an operation that corrupts or throws an error
      const failedOp = withDatasetSafety(testTarget, testBackup, async () => {
        // Corrupt the target in memory/disk
        writeFileSync(testTarget, 'corrupted content or empty array', 'utf-8');
        throw new Error('Simulated crash during processing');
      });

      // 3. Verify operation threw error
      await expect(failedOp).rejects.toThrow('Simulated crash during processing');

      // 4. Verify existing dataset was automatically restored and remains 100% intact
      expect(existsSync(testTarget)).toBe(true);
      const restored = JSON.parse(readFileSync(testTarget, 'utf-8'));
      expect(restored).toEqual(validInitialData);
    });

    it('protects existing dataset when classification validation fails', async () => {
      // 1. Write valid existing repos.json
      atomicWriteJson(testTarget, validInitialData);

      // 2. Write invalid raw data with negative stars and bad URL to fail schema validation
      const invalidRaw = [
        {
          id: 999,
          name: 'broken-repo',
          fullName: 'owner/broken-repo',
          owner: 'owner',
          description: 'broken',
          topics: ['broken'],
          language: 'Go',
          stars: -10, // Invalid negative stars, triggers schema validation failure
          url: 'not-a-valid-url',
          updatedAt: 'not-a-date',
          archived: false,
          fork: false,
        },
      ];
      writeFileSync(testRaw, JSON.stringify(invalidRaw), 'utf-8');

      // 3. Attempt to run classification safely
      const failingClassification = withDatasetSafety(testTarget, testBackup, () =>
        runClassification(testRaw, testTarget)
      );

      await expect(failingClassification).rejects.toThrow('Validation failed');

      // 4. Verify existing dataset is preserved and intact
      const existing = JSON.parse(readFileSync(testTarget, 'utf-8'));
      expect(existing).toEqual(validInitialData);
    });
  });
});
