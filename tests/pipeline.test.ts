import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeRepo, type RawGitHubRepo } from '../scripts/lib/normalize.ts';
import { classifyWithRules, tokenizeRepoName, normalizeTopic, scoreDomainsWithSaturation, classifyRepo, classifyWithLLM, GEMINI_MODEL } from '../scripts/lib/classifier.ts';
import { computeInputHash, loadCache, saveCache } from '../scripts/lib/cache.ts';
import { RateLimiter, executeWithRetry, extractRetryDelayMs, isRateLimitError, isUnavailableError } from '../scripts/lib/rate-limiter.ts';
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

    it('extracts tokens from hyphenated, snake_case, and camelCase repository names', () => {
      expect(tokenizeRepoName('awesome-machine-learning')).toEqual(['awesome', 'machine', 'learning']);
      expect(tokenizeRepoName('PythonDataScienceHandbook')).toEqual(['python', 'data', 'science', 'handbook']);
      expect(tokenizeRepoName('Python-100-Days')).toEqual(['python', '100', 'days']);
      expect(tokenizeRepoName('PromptEngineeringCourse')).toEqual(['prompt', 'engineering', 'course']);
      expect(tokenizeRepoName('time_series_predictor')).toEqual(['time', 'series', 'predictor']);
      expect(tokenizeRepoName('data-engineer-handbook')).toEqual(['data', 'engineer', 'handbook']);
    });

    it('normalizes equivalent topic forms canonically', () => {
      expect(normalizeTopic('dataengineering')).toBe('data-engineering');
      expect(normalizeTopic('data_science')).toBe('data-science');
      expect(normalizeTopic('goodbyedpi')).toBe('goodbye-dpi');
      expect(normalizeTopic('speechrecognition')).toBe('speech-recognition');
      expect(normalizeTopic('apachespark')).toBe('spark');
    });

    it('authoritatively classifies repos with strong domain signals even when topics are sparse', () => {
      const whisperRepo = normalizeRepo({
        id: 10,
        name: 'whisper',
        full_name: 'openai/whisper',
        description: 'Robust Speech Recognition via Large-Scale Weak Supervision',
        topics: [],
        language: 'Python',
        stargazers_count: 109000,
        html_url: 'https://github.com/openai/whisper',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(whisperRepo);
      expect(res?.category).toBe('ML / AI');
      expect(res?.method).toBe('rule');
    });

    it('allows strong domain signals to beat weak incidental signals (e.g. data-engineer-handbook)', () => {
      const handbookRepo = normalizeRepo({
        id: 11,
        name: 'data-engineer-handbook',
        full_name: 'DataExpert-io/data-engineer-handbook',
        description: "This is a repo with links to everything you'd ever want to learn about data engineering",
        topics: ['apachespark', 'awesome', 'bigdata', 'data', 'dataengineering', 'sql'],
        language: 'Jupyter Notebook',
        stargazers_count: 25000,
        html_url: 'https://github.com/DataExpert-io/data-engineer-handbook',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(handbookRepo);
      expect(res?.category).toBe('Data Engineering');
      expect(res?.method).toBe('rule');
    });
  });

  describe('Intent vs Domain Decoupled Classification Architecture', () => {
    it('1. caps domain topic contribution at exactly 6 points regardless of topic quantity', () => {
      const manyAiTopics = [
        'pytorch', 'tensorflow', 'llm', 'deep-learning', 'rag',
        'machine-learning', 'nlp', 'transformers', 'diffusion', 'langchain'
      ];
      const scores = scoreDomainsWithSaturation(manyAiTopics, [], '', '');
      // 1st topic = 3, 2nd = 2, 3rd = 1, subsequent = 0 => Total = 6
      expect(scores.ai.score).toBe(6);
      expect(scores.ai.matchedTopics.length).toBe(10);
    });

    it('2. prioritizes educational intent over strong AI domain signals', () => {
      const repo = normalizeRepo({
        id: 201,
        name: 'ai-curriculum',
        full_name: 'edu-org/ai-curriculum',
        description: 'Comprehensive tutorials and curriculum for learning deep learning and neural networks',
        topics: ['pytorch', 'tensorflow', 'deep-learning', 'llm', 'tutorial', 'curriculum'],
        language: 'Jupyter Notebook',
        stargazers_count: 10000,
        html_url: 'https://github.com/edu-org/ai-curriculum',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(repo);
      expect(res).not.toBeNull();
      expect(res?.category).toBe('Learning / Docs');
    });

    it('3. prioritizes executable tool intent over AI domain signals', () => {
      const repo = normalizeRepo({
        id: 202,
        name: 'ai-terminal-cli',
        full_name: 'tools-dev/ai-terminal-cli',
        description: 'A command line interface tool and terminal utility for chatting with LLMs',
        topics: ['cli', 'terminal', 'utility', 'llm', 'genai', 'gemini'],
        language: 'Go',
        stargazers_count: 5000,
        html_url: 'https://github.com/tools-dev/ai-terminal-cli',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(repo);
      expect(res).not.toBeNull();
      expect(res?.category).toBe('CLI / Tools');
    });

    it('4. prioritizes interactive web frontend intent over AI domain signals', () => {
      const repo = normalizeRepo({
        id: 203,
        name: 'llm-weights-visualizer',
        full_name: 'ui-team/llm-weights-visualizer',
        description: 'Interactive web frontend visualizer and UI for inspecting neural network weights',
        topics: ['react', 'frontend', 'visualization', 'visualizer', 'web-app', 'llm', 'deep-learning'],
        language: 'TypeScript',
        stargazers_count: 3500,
        html_url: 'https://github.com/ui-team/llm-weights-visualizer',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(repo);
      expect(res).not.toBeNull();
      expect(res?.category).toBe('Web Frontend');
    });

    it('5. prioritizes workflow orchestration platform over AI domain signals', () => {
      const repo = normalizeRepo({
        id: 204,
        name: 'agent-workflow-engine',
        full_name: 'infra/agent-workflow-engine',
        description: 'Self-hosted workflow automation platform and orchestrator integrating AI agents',
        topics: ['workflow-automation', 'orchestration', 'self-hosted', 'agents', 'llm'],
        language: 'TypeScript',
        stargazers_count: 8500,
        html_url: 'https://github.com/infra/agent-workflow-engine',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(repo);
      expect(res).not.toBeNull();
      expect(res?.category).toBe('DevOps / Infra');
    });

    it('6. classifies core model and algorithm implementations as ML / AI', () => {
      const repo = normalizeRepo({
        id: 205,
        name: 'whisper-transcription-engine',
        full_name: 'audio/whisper-transcription-engine',
        description: 'Zero-shot speech recognition deep learning model and inference algorithm',
        topics: ['speech-recognition', 'deep-learning', 'inference'],
        language: 'Python',
        stargazers_count: 45000,
        html_url: 'https://github.com/audio/whisper-transcription-engine',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(repo);
      expect(res).not.toBeNull();
      expect(res?.category).toBe('ML / AI');
    });

    it('7. assigns high confidence to authoritative multi-word phrases and clear structural intent', () => {
      const repo = normalizeRepo({
        id: 206,
        name: 'system-debloater',
        full_name: 'admin/system-debloater',
        description: 'Command line interface system utility tool for converting and tweaking systems',
        topics: ['cli', 'system-utility', 'tweaks'],
        language: 'PowerShell',
        stargazers_count: 6000,
        html_url: 'https://github.com/admin/system-debloater',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(repo);
      expect(res).not.toBeNull();
      expect(res?.confidence).toBeGreaterThanOrEqual(0.93);
    });

    it('8. routes sparse metadata repositories to fallback (returns null from deterministic rules)', () => {
      const repo = normalizeRepo({
        id: 207,
        name: 'my-random-project',
        full_name: 'anon/my-random-project',
        description: 'A simple script that does stuff',
        topics: [],
        language: 'Python',
        stargazers_count: 2,
        html_url: 'https://github.com/anon/my-random-project',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res = classifyWithRules(repo);
      expect(res).toBeNull();
    });

    it('9. produces deterministic results across multiple evaluations of boundary repos', () => {
      const repo = normalizeRepo({
        id: 208,
        name: 'data-pipeline-tutorial',
        full_name: 'study/data-pipeline-tutorial',
        description: 'Tutorial covering ETL pipeline concepts and data engineering principles',
        topics: ['etl', 'tutorial', 'data-pipeline'],
        language: 'Python',
        stargazers_count: 1200,
        html_url: 'https://github.com/study/data-pipeline-tutorial',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const res1 = classifyWithRules(repo);
      const res2 = classifyWithRules(repo);
      const res3 = classifyWithRules(repo);
      expect(res1).toEqual(res2);
      expect(res2).toEqual(res3);
    });

    it('10. preserves canonical categories across all active categories in regression check', () => {
      const sampleNames = [
        { name: 'goodbyedpi', topics: ['security', 'goodbye-dpi'], expected: 'Security' },
        { name: 'sdmaid-cleaner', topics: ['android', 'cleaner'], expected: 'Mobile' },
        { name: 'twikit-scraper', topics: ['twitter-api', 'api-client'], expected: 'Backend / API' },
        { name: 'microgpt-visualizer', topics: ['frontend', 'visualization'], expected: 'Web Frontend' },
        { name: 'k8s-platform', topics: ['kubernetes', 'terraform'], expected: 'DevOps / Infra' },
        { name: 'missingno', topics: ['data-profiling', 'missing-data'], expected: 'Data Engineering' },
        { name: 'winutil', topics: ['cli', 'utility'], expected: 'CLI / Tools' },
        { name: 'python-cheatsheet', topics: ['cheatsheet', 'tutorial'], expected: 'Learning / Docs' },
      ];

      for (const sample of sampleNames) {
        const repo = normalizeRepo({
          id: 300,
          name: sample.name,
          full_name: `owner/${sample.name}`,
          description: `Description for ${sample.name}`,
          topics: sample.topics,
          language: 'TypeScript',
          stargazers_count: 100,
          html_url: `https://github.com/owner/${sample.name}`,
          updated_at: '2026-01-01T00:00:00Z',
        });
        const res = classifyWithRules(repo);
        expect(res?.category).toBe(sample.expected);
      }
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

    it('returns empty cache when cache file does not exist', () => {
      const nonExistent = resolve(process.cwd(), 'data', 'non-existent-cache.tmp.json');
      const loaded = loadCache(nonExistent);
      expect(loaded).toEqual({});
    });

    it('saves and reloads cache entries from disk atomically', () => {
      const tempCache = resolve(process.cwd(), 'data', 'temp-cache-test.tmp.json');
      const sample = {
        'test/sample-repo': {
          category: 'CLI / Tools' as const,
          classification: {
            method: 'rule' as const,
            confidence: 0.95,
            classifiedAt: '2026-01-01T00:00:00Z',
            inputHash: 'hash123',
          },
        },
      };

      saveCache(sample, tempCache);
      expect(existsSync(tempCache)).toBe(true);

      const loaded = loadCache(tempCache);
      expect(loaded['test/sample-repo']?.category).toBe('CLI / Tools');
      expect(loaded['test/sample-repo']?.classification.inputHash).toBe('hash123');

      try { unlinkSync(tempCache); } catch { /* ignore */ }
    });
  });

  describe('Gemini Fallback & Error Resilience', () => {
    it('does not invoke Gemini fallback for high-confidence deterministic classifications', async () => {
      const repo = normalizeRepo({
        id: 701,
        name: 'whisper',
        full_name: 'openai/whisper',
        description: 'Robust speech recognition deep learning model',
        topics: ['speech-recognition', 'deep-learning'],
        language: 'Python',
        stargazers_count: 50000,
        html_url: 'https://github.com/openai/whisper',
        updated_at: '2026-01-01T00:00:00Z',
      });

      // Passing an invalid dummy API key would throw if LLM were invoked
      const res = await classifyRepo(repo, 'invalid-nonexistent-api-key');
      expect(res.category).toBe('ML / AI');
      expect(res.method).toBe('rule');
      expect(res.confidence).toBeGreaterThanOrEqual(0.94);
    });

    it('safely handles missing GEMINI_API_KEY for ambiguous/sparse repositories without throwing', async () => {
      const sparseRepo = normalizeRepo({
        id: 702,
        name: 'claw-code',
        full_name: 'ultraworkers/claw-code',
        description: 'An agent-managed museum exhibit, built in Rust with Gajae-Code / LazyCodex',
        topics: [],
        language: 'Rust',
        stargazers_count: 1000,
        html_url: 'https://github.com/ultraworkers/claw-code',
        updated_at: '2026-01-01T00:00:00Z',
      });

      // Rule classification returns null for sparse metadata
      const ruleRes = classifyWithRules(sparseRepo);
      expect(ruleRes).toBeNull();

      // Explicitly passing empty key simulates absent GEMINI_API_KEY
      const res = await classifyRepo(sparseRepo, '');
      expect(res.category).toBe('Other');
      expect(res.method).toBe('fallback');
      expect(res.confidence).toBe(0.5);
    });

    it('safely catches and recovers from Gemini API errors without crashing the pipeline', async () => {
      const sparseRepo = normalizeRepo({
        id: 703,
        name: 'ambiguous-project',
        full_name: 'anon/ambiguous-project',
        description: 'An ambiguous experimental codebase',
        topics: [],
        language: 'C++',
        stargazers_count: 5,
        html_url: 'https://github.com/anon/ambiguous-project',
        updated_at: '2026-01-01T00:00:00Z',
      });

      // Passing an invalid key will trigger an API error inside classifyWithLLM
      const res = await classifyWithLLM(sparseRepo, 'invalid-key-that-causes-auth-error');
      expect(res.category).toBe('Other');
      expect(res.method).toBe('fallback');
      expect(res.confidence).toBe(0.5);
    });

    it('configures the recommended gemini-3.8-flash model identifier', () => {
      expect(GEMINI_MODEL).toBe('gemini-3.8-flash');
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

  describe('Safe Local Dry Run & Production Flow', () => {
    const dryRunTarget = resolve(process.cwd(), 'data', 'dryrun-repos.tmp.json');
    const dryRunRaw = resolve(process.cwd(), 'data', 'dryrun-raw.tmp.json');

    afterEach(() => {
      [dryRunTarget, dryRunRaw].forEach(p => {
        if (existsSync(p)) {
          try { unlinkSync(p); } catch { /* ignore */ }
        }
      });
    });

    it('executes full classification pipeline dry run with cache reuse and schema validation', async () => {
      // 1. Prepare raw fixture
      const rawData = [
        {
          id: 66,
          name: 'whisper',
          fullName: 'openai/whisper',
          owner: 'openai',
          description: 'Robust Speech Recognition via Large-Scale Weak Supervision',
          topics: ['speech-recognition', 'deep-learning'],
          language: 'Python',
          stars: 100000,
          url: 'https://github.com/openai/whisper',
          updatedAt: '2026-01-01T00:00:00Z',
          archived: false,
          fork: false,
        },
        {
          id: 88,
          name: 'custom-utility-cli',
          fullName: 'org/custom-utility-cli',
          owner: 'org',
          description: 'A command line interface system utility tool for administration',
          topics: ['cli', 'utility'],
          language: 'Go',
          stars: 50,
          url: 'https://github.com/org/custom-utility-cli',
          updatedAt: '2026-01-01T00:00:00Z',
          archived: false,
          fork: false,
        },
      ];

      writeFileSync(dryRunRaw, JSON.stringify(rawData, null, 2), 'utf-8');

      // 2. Run classification with safe dryRun paths
      const result = await runClassification(dryRunRaw, dryRunTarget);

      // 3. Verify results
      expect(result.length).toBe(2);
      expect(existsSync(dryRunTarget)).toBe(true);

      const whisper = result.find(r => r.name === 'whisper');
      expect(whisper?.category).toBe('ML / AI');
      expect(whisper?.classification.method).toBe('rule');

      const tool = result.find(r => r.name === 'custom-utility-cli');
      expect(tool?.category).toBe('CLI / Tools');
      expect(tool?.classification.method).toBe('rule');

      // 4. Verify validation passes on generated dataset
      const validation = validateRepos(result);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('invalidates cache entry and reclassifies when repository metadata changes', async () => {
      // 1. Initial run: CLI tool
      const rawInitial = [
        {
          id: 99,
          name: 'changing-app',
          fullName: 'user/changing-app',
          owner: 'user',
          description: 'A command line interface tool and utility',
          topics: ['cli', 'utility'],
          language: 'Go',
          stars: 10,
          url: 'https://github.com/user/changing-app',
          updatedAt: '2026-01-01T00:00:00Z',
          archived: false,
          fork: false,
        },
      ];
      writeFileSync(dryRunRaw, JSON.stringify(rawInitial, null, 2), 'utf-8');
      const res1 = await runClassification(dryRunRaw, dryRunTarget);
      expect(res1[0].category).toBe('CLI / Tools');
      const hash1 = res1[0].classification.inputHash;

      // 2. Metadata changes: transformed into an interactive web frontend visualizer
      const rawUpdated = [
        {
          ...rawInitial[0],
          description: 'Interactive web frontend visualizer and UI dashboard',
          topics: ['frontend', 'react', 'visualization', 'web-app'],
          language: 'TypeScript',
        },
      ];
      writeFileSync(dryRunRaw, JSON.stringify(rawUpdated, null, 2), 'utf-8');
      const res2 = await runClassification(dryRunRaw, dryRunTarget);
      expect(res2[0].category).toBe('Web Frontend');
      const hash2 = res2[0].classification.inputHash;

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Rate Limiting, Retries & Safe Fallback Cache', () => {
    const testCachePath = resolve(process.cwd(), 'data', 'test-cache.tmp.json');
    const testReposPath = resolve(process.cwd(), 'data', 'test-repos-seed.tmp.json');

    afterEach(() => {
      if (existsSync(testCachePath)) unlinkSync(testCachePath);
      if (existsSync(testReposPath)) unlinkSync(testReposPath);
      vi.restoreAllMocks();
    });

    it('rate limiter enforces target spacing ensuring <= 5 requests/minute', async () => {
      const limiter = new RateLimiter({ minIntervalMs: 12500 });
      expect(limiter.getMinIntervalMs()).toBe(12500);

      // Verify pacing with a mock sleepFn
      const sleepCalls: number[] = [];
      const mockSleep = async (ms: number) => {
        sleepCalls.push(ms);
      };

      await limiter.acquire(mockSleep);
      expect(sleepCalls.length).toBe(0); // first call dispatches immediately

      // Immediately acquiring second request should wait for remaining interval
      await limiter.acquire(mockSleep);
      expect(sleepCalls.length).toBe(1);
      expect(sleepCalls[0]).toBeGreaterThanOrEqual(12400);
      expect(sleepCalls[0]).toBeLessThanOrEqual(12500);
    });

    it('retries on HTTP 429 respecting server retryDelay', async () => {
      let attempts = 0;
      const sleepDelays: number[] = [];
      const mockSleep = async (ms: number) => {
        sleepDelays.push(ms);
      };

      const result = await executeWithRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('ClientError: got status: 429 Too Many Requests. {"details":[{"retryDelay":"15s"}]}');
          }
          return { success: true };
        },
        {
          maxRetries: 2,
          sleepFn: mockSleep,
        }
      );

      expect(attempts).toBe(2);
      expect(result.success).toBe(true);
      expect(sleepDelays.length).toBe(1);
      expect(sleepDelays[0]).toBe(16000); // 15s + 1000ms buffer
    });

    it('retries on HTTP 503 using exponential backoff', async () => {
      let attempts = 0;
      const sleepDelays: number[] = [];
      const mockSleep = async (ms: number) => {
        sleepDelays.push(ms);
      };

      const result = await executeWithRetry(
        async () => {
          attempts++;
          if (attempts <= 2) {
            throw new Error('ServerError: got status: 503 Service Unavailable. Spikes in demand');
          }
          return { category: 'ML / AI', confidence: 0.9 };
        },
        {
          maxRetries: 3,
          baseDelayMs: 100,
          sleepFn: mockSleep,
        }
      );

      expect(attempts).toBe(3);
      expect(result.category).toBe('ML / AI');
      expect(sleepDelays.length).toBe(2);
      expect(sleepDelays[0]).toBe(200); // baseDelay * 2^1
      expect(sleepDelays[1]).toBe(400); // baseDelay * 2^2
    });

    it('eventually falls back safely when retry limit is exhausted', async () => {
      const sparseRepo = normalizeRepo({
        id: 999,
        name: 'unstable-api-repo',
        full_name: 'test/unstable-api-repo',
        description: 'Random obscure project',
        topics: [],
        language: 'C++',
        stargazers_count: 5,
        html_url: 'https://github.com/test/unstable-api-repo',
        updated_at: '2026-01-01T00:00:00Z',
      });

      // classifyWithLLM with maxRetries = 1 and dummy sleepFn
      const res = await classifyWithLLM(sparseRepo, {
        apiKey: 'test-failing-key',
        maxRetries: 1,
        sleepFn: async () => {},
        rateLimiter: new RateLimiter({ minIntervalMs: 0 }),
      });

      expect(res.category).toBe('Other');
      expect(res.method).toBe('fallback');
      expect(res.confidence).toBe(0.5);
    });

    it('never persists fallback classifications in cache', () => {
      const initialCache = {
        'test/successful-llm': {
          category: 'ML / AI' as const,
          classification: {
            method: 'llm' as const,
            confidence: 0.88,
            classifiedAt: '2026-01-01T00:00:00Z',
            inputHash: 'hash1',
          },
        },
        'test/failed-fallback': {
          category: 'Other' as const,
          classification: {
            method: 'fallback' as const,
            confidence: 0.5,
            classifiedAt: '2026-01-01T00:00:00Z',
            inputHash: 'hash2',
          },
        },
      };

      saveCache(initialCache, testCachePath);

      // Load cache without seeding
      const loaded = loadCache(testCachePath, null);
      expect(loaded['test/successful-llm']).toBeDefined();
      expect(loaded['test/successful-llm'].category).toBe('ML / AI');
      expect(loaded['test/successful-llm'].classification.method).toBe('llm');

      // The fallback entry must NOT be present
      expect(loaded['test/failed-fallback']).toBeUndefined();
    });

    it('seeds and reuses persisted rule and LLM classifications from data/repos.json with matching inputHash', () => {
      const mockRepos: Repository[] = [
        {
          id: 101,
          name: 'persisted-rule-repo',
          fullName: 'org/persisted-rule-repo',
          owner: 'org',
          description: 'A React component library',
          topics: ['react', 'ui'],
          language: 'TypeScript',
          stars: 100,
          url: 'https://github.com/org/persisted-rule-repo',
          updatedAt: '2026-01-01T00:00:00Z',
          archived: false,
          fork: false,
          category: 'Web Frontend',
          classification: {
            method: 'rule',
            confidence: 0.95,
            classifiedAt: '2026-01-01T00:00:00Z',
            inputHash: computeInputHash({
              fullName: 'org/persisted-rule-repo',
              description: 'A React component library',
              topics: ['react', 'ui'],
              language: 'TypeScript',
            }),
          },
        },
        {
          id: 102,
          name: 'persisted-llm-repo',
          fullName: 'org/persisted-llm-repo',
          owner: 'org',
          description: 'Curated list of materials',
          topics: [],
          language: null,
          stars: 50,
          url: 'https://github.com/org/persisted-llm-repo',
          updatedAt: '2026-01-01T00:00:00Z',
          archived: false,
          fork: false,
          category: 'Learning / Docs',
          classification: {
            method: 'llm',
            confidence: 0.85,
            classifiedAt: '2026-01-01T00:00:00Z',
            inputHash: computeInputHash({
              fullName: 'org/persisted-llm-repo',
              description: 'Curated list of materials',
              topics: [],
              language: null,
            }),
          },
        },
        {
          id: 103,
          name: 'persisted-fallback-repo',
          fullName: 'org/persisted-fallback-repo',
          owner: 'org',
          description: 'An ambiguous project that previously failed',
          topics: [],
          language: null,
          stars: 10,
          url: 'https://github.com/org/persisted-fallback-repo',
          updatedAt: '2026-01-01T00:00:00Z',
          archived: false,
          fork: false,
          category: 'Other',
          classification: {
            method: 'fallback',
            confidence: 0.5,
            classifiedAt: '2026-01-01T00:00:00Z',
            inputHash: computeInputHash({
              fullName: 'org/persisted-fallback-repo',
              description: 'An ambiguous project that previously failed',
              topics: [],
              language: null,
            }),
          },
        },
      ];

      writeFileSync(testReposPath, JSON.stringify(mockRepos, null, 2), 'utf-8');

      // Load cache specifying the mock repos.json as seed
      const cache = loadCache(testCachePath, testReposPath);

      // Rule and LLM entries must be present
      expect(cache['org/persisted-rule-repo']).toBeDefined();
      expect(cache['org/persisted-rule-repo'].category).toBe('Web Frontend');
      expect(cache['org/persisted-rule-repo'].classification.method).toBe('rule');

      expect(cache['org/persisted-llm-repo']).toBeDefined();
      expect(cache['org/persisted-llm-repo'].category).toBe('Learning / Docs');
      expect(cache['org/persisted-llm-repo'].classification.method).toBe('llm');

      // The fallback entry must NOT be seeded into cache
      expect(cache['org/persisted-fallback-repo']).toBeUndefined();
    });

    it('fallback is eligible for future retry because it is not cached', () => {
      // Repos with method fallback are not cached
      const cache = loadCache(testCachePath, null);
      expect(cache['org/unclassified-repo']).toBeUndefined();

      // On next run, without a cache hit, classifyRepo is called
      const repo = normalizeRepo({
        id: 888,
        name: 'retry-candidate',
        full_name: 'test/retry-candidate',
        description: 'Eligible for retry',
        topics: [],
        language: 'Python',
        stargazers_count: 5,
        html_url: 'https://github.com/test/retry-candidate',
        updated_at: '2026-01-01T00:00:00Z',
      });

      const inputHash = computeInputHash(repo);
      const isCacheHit = Boolean(cache[repo.fullName] && cache[repo.fullName].classification.inputHash === inputHash);
      expect(isCacheHit).toBe(false);
    });

    it('accurately parses rate limit and unavailable error types and delays', () => {
      expect(isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
      expect(isRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
      expect(isRateLimitError(new Error('500 Internal Server Error'))).toBe(false);

      expect(isUnavailableError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isUnavailableError(new Error('UNAVAILABLE'))).toBe(true);
      expect(isUnavailableError(new Error('404 Not Found'))).toBe(false);

      expect(extractRetryDelayMs(new Error('{"retryDelay":"12s"}'))).toBe(13000);
      expect(extractRetryDelayMs(new Error('Please retry in 5.5s.'))).toBe(6500);
      expect(extractRetryDelayMs(new Error('Generic failure'))).toBeNull();
    });
  });
});
