import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GEMINI_MODEL,
  GeminiQuotaError,
  buildClassificationPrompt,
  parseClassificationResponse,
} from '../src/core/llm.ts';
import {
  RateLimiter,
  executeWithRetry,
  isQuotaExceededError,
  isRateLimitError,
  isUnavailableError,
} from '../src/core/rate-limiter.ts';
import {
  saveGeminiKey,
  loadGeminiKey,
  clearGeminiKey,
  isGeminiKeyRemembered,
  saveGeminiSettings,
  loadGeminiSettings,
} from '../src/lib/storage/settings.ts';
import { MemoryStore } from '../src/lib/storage/datasetStore.ts';
import { syncStarredRepos } from '../src/lib/sync.ts';
import type { NormalizedRepo } from '../src/core/normalize.ts';
import { computeInputHash } from '../src/core/hash.ts';

class MockStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

describe('LLM & Rate Limiter (src/core/llm.ts & src/core/rate-limiter.ts)', () => {
  describe('GEMINI_MODEL constant', () => {
    it('is configured as gemini-3.8-flash', () => {
      expect(GEMINI_MODEL).toBe('gemini-3.8-flash');
      expect(new GeminiQuotaError()).toBeInstanceOf(Error);
    });
  });

  describe('buildClassificationPrompt', () => {
    it('constructs a prompt containing repo details and instructions', () => {
      const repo: NormalizedRepo = {
        id: 1,
        name: 'test-repo',
        fullName: 'owner/test-repo',
        owner: 'owner',
        description: 'A test repository description',
        topics: ['web', 'vite'],
        language: 'TypeScript',
        stars: 50,
        url: 'https://github.com/owner/test-repo',
        updatedAt: '2026-01-01T00:00:00Z',
        archived: false,
        fork: false,
      };
      const prompt = buildClassificationPrompt(repo);
      expect(prompt).toContain('owner/test-repo');
      expect(prompt).toContain('A test repository description');
      expect(prompt).toContain('TypeScript');
      expect(prompt).toContain('Topics: web, vite');
      expect(prompt).toContain('Web Frontend');
      expect(prompt).toContain('Respond with a valid JSON object');
    });
  });

  describe('parseClassificationResponse', () => {
    it('parses valid JSON response with permitted category', () => {
      const raw = JSON.stringify({
        category: 'Web Frontend',
        confidence: 0.88,
        reasoning: 'React UI component library',
      });
      const parsed = parseClassificationResponse(raw);
      expect(parsed).toEqual({
        category: 'Web Frontend',
        confidence: 0.88,
      });
    });

    it('strips markdown code blocks and whitespace', () => {
      const raw = "```json\n{\n  \"category\": \"DevOps / Infra\",\n  \"confidence\": 0.92\n}\n```";
      const parsed = parseClassificationResponse(raw);
      expect(parsed).toEqual({
        category: 'DevOps / Infra',
        confidence: 0.92,
      });
    });

    it('clamps confidence below 0.5 up to 0.5', () => {
      const raw = JSON.stringify({
        category: 'Backend / API',
        confidence: 0.2,
      });
      const parsed = parseClassificationResponse(raw);
      expect(parsed?.confidence).toBe(0.5);
    });

    it('clamps confidence above 0.99 down to 0.99', () => {
      const raw = JSON.stringify({
        category: 'Backend / API',
        confidence: 1.0,
      });
      const parsed = parseClassificationResponse(raw);
      expect(parsed?.confidence).toBe(0.99);
    });

    it('defaults confidence to 0.85 if missing or invalid', () => {
      const raw = JSON.stringify({
        category: 'ML / AI',
      });
      const parsed = parseClassificationResponse(raw);
      expect(parsed?.confidence).toBe(0.85);
    });

    it('returns null for unallowed category', () => {
      const raw = JSON.stringify({
        category: 'Rocket Science',
        confidence: 0.95,
      });
      const parsed = parseClassificationResponse(raw);
      expect(parsed).toBeNull();
    });

    it('returns null for non-JSON or malformed text', () => {
      expect(parseClassificationResponse('Not JSON')).toBeNull();
      expect(parseClassificationResponse('{ category: broken }')).toBeNull();
      expect(parseClassificationResponse('{"missing_category": true}')).toBeNull();
      expect(parseClassificationResponse('42')).toBeNull();
    });
  });

  describe('RateLimiter & executeWithRetry', () => {
    it('throttles calls using custom sleepFn according to minIntervalMs', async () => {
      const sleeps: number[] = [];
      const sleepFn = async (ms: number) => {
        sleeps.push(ms);
      };

      const limiter = new RateLimiter({ minIntervalMs: 100, sleepFn });

      // First call: no wait
      await limiter.acquire();
      expect(sleeps.length).toBe(0);

      // Second immediate call: should wait ~100ms
      await limiter.acquire();
      expect(sleeps.length).toBe(1);
      expect(sleeps[0]).toBeGreaterThanOrEqual(90);
    });

    it('aborts acquire if signal is already aborted or aborted during wait', async () => {
      const controller = new AbortController();
      controller.abort();
      const limiter = new RateLimiter({ minIntervalMs: 100 });
      await expect(limiter.acquire(controller.signal)).rejects.toThrow(/aborted/i);
    });

    it('identifies rate limit and quota exceeded errors accurately', () => {
      const quotaErr = { status: 429, message: 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric' };
      expect(isQuotaExceededError(quotaErr)).toBe(true);

      const standard429 = { status: 429, message: 'Too many requests' };
      expect(isQuotaExceededError(standard429)).toBe(false);
      expect(isRateLimitError(standard429)).toBe(true);

      const serviceUnavailable = { status: 503, message: 'Service Unavailable' };
      expect(isUnavailableError(serviceUnavailable)).toBe(true);
    });

    it('executeWithRetry throws immediately on quota exhaustion without retrying', async () => {
      const quotaErr = { status: 429, message: 'RESOURCE_EXHAUSTED' };
      let attempts = 0;

      await expect(
        executeWithRetry(async () => {
          attempts++;
          throw quotaErr;
        }, { maxRetries: 3 })
      ).rejects.toEqual(quotaErr);

      expect(attempts).toBe(1); // No retries on quota exhaustion
    });

    it('executeWithRetry retries on transient 503 and succeeds', async () => {
      let attempts = 0;
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const result = await executeWithRetry(
        async () => {
          attempts++;
          if (attempts < 2) {
            throw { status: 503, message: 'Temporarily Unavailable' };
          }
          return 'ok';
        },
        { maxRetries: 2, sleepFn, baseDelayMs: 10 }
      );

      expect(result).toBe('ok');
      expect(attempts).toBe(2);
      expect(sleepFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Gemini key & settings persistence in settings.ts', () => {
    let mockSessionStorage: MockStorage;
    let mockLocalStorage: MockStorage;

    beforeEach(() => {
      mockSessionStorage = new MockStorage();
      mockLocalStorage = new MockStorage();
      vi.stubGlobal('sessionStorage', mockSessionStorage);
      vi.stubGlobal('localStorage', mockLocalStorage);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('saves Gemini key to sessionStorage when remember=false', () => {
      saveGeminiKey('AIzaSyTestSessionKey', false);
      expect(mockSessionStorage.getItem('starred_repos_gemini_key')).toBe('AIzaSyTestSessionKey');
      expect(mockLocalStorage.getItem('starred_repos_gemini_key')).toBeNull();
      expect(loadGeminiKey()).toBe('AIzaSyTestSessionKey');
      expect(isGeminiKeyRemembered()).toBe(false);
    });

    it('saves Gemini key to localStorage when remember=true', () => {
      saveGeminiKey('AIzaSyTestLocalKey', true);
      expect(mockLocalStorage.getItem('starred_repos_gemini_key')).toBe('AIzaSyTestLocalKey');
      expect(mockSessionStorage.getItem('starred_repos_gemini_key')).toBeNull();
      expect(loadGeminiKey()).toBe('AIzaSyTestLocalKey');
      expect(isGeminiKeyRemembered()).toBe(true);
    });

    it('clears Gemini key from both storages', () => {
      saveGeminiKey('AIzaSyTestLocalKey', true);
      clearGeminiKey();
      expect(loadGeminiKey()).toBeNull();
      expect(isGeminiKeyRemembered()).toBe(false);
    });

    it('saves and loads custom model and interval settings', () => {
      expect(loadGeminiSettings()).toEqual({
        model: 'gemini-3.8-flash',
        intervalSec: 4,
      });

      saveGeminiSettings({
        model: 'gemini-1.5-flash',
        intervalSec: 2,
      });

      expect(loadGeminiSettings()).toEqual({
        model: 'gemini-1.5-flash',
        intervalSec: 2,
      });
    });
  });
});

describe('Hybrid Sync with Gemini (src/lib/sync.ts)', () => {
  const originalFetch = globalThis.fetch;
  let mockSessionStorage: MockStorage;
  let mockLocalStorage: MockStorage;

  beforeEach(() => {
    mockSessionStorage = new MockStorage();
    mockLocalStorage = new MockStorage();
    vi.stubGlobal('sessionStorage', mockSessionStorage);
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const setupMockGitHub = (repos: any[]) => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/user')) {
        return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 });
      }
      if (url.includes('/user/starred')) {
        return new Response(JSON.stringify(repos), { status: 200, headers: { Link: '' } });
      }
      if (url.includes('/graphql')) {
        return new Response(JSON.stringify({ data: { viewer: { lists: { nodes: [] } } } }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };
  };

  it('hybrid classification: rule match -> Gemini not called; rule miss -> Gemini called; cache hit -> not called', async () => {
    // Repo 1: Clear rule match (React -> Frontend Frameworks & UI)
    const ruleRepo = {
      id: 101,
      name: 'react-widget',
      full_name: 'octocat/react-widget',
      owner: { login: 'octocat' },
      description: 'A React UI widget',
      topics: ['react', 'ui'],
      language: 'TypeScript',
      stargazers_count: 50,
      html_url: 'https://github.com/octocat/react-widget',
      updated_at: '2026-01-01T00:00:00Z',
    };

    // Repo 2: Ambiguous (no rules match), should trigger Gemini
    const ambiguousRepo = {
      id: 102,
      name: 'quantum-sorter',
      full_name: 'octocat/quantum-sorter',
      owner: { login: 'octocat' },
      description: 'An esoteric experimental sorter',
      topics: ['experimental'],
      language: 'C++',
      stargazers_count: 10,
      html_url: 'https://github.com/octocat/quantum-sorter',
      updated_at: '2026-01-01T00:00:00Z',
    };

    // Repo 3: Ambiguous, but pre-cached in store!
    const cachedAmbiguousRepo = {
      id: 103,
      name: 'old-cached-tool',
      full_name: 'octocat/old-cached-tool',
      owner: { login: 'octocat' },
      description: 'Pre-existing cached tool',
      topics: [],
      language: 'Go',
      stargazers_count: 5,
      html_url: 'https://github.com/octocat/old-cached-tool',
      updated_at: '2026-01-01T00:00:00Z',
    };

    setupMockGitHub([ruleRepo, ambiguousRepo, cachedAmbiguousRepo]);

    const store = new MemoryStore();
    const cachedHash = computeInputHash({
      fullName: 'octocat/old-cached-tool',
      description: 'Pre-existing cached tool',
      topics: [],
      language: 'Go',
    });

    await store.set('classificationCache', {
      'octocat/old-cached-tool': {
        category: 'CLI / Tools',
        classification: {
          method: 'llm',
          confidence: 0.85,
          classifiedAt: '2026-01-01T00:00:00Z',
          inputHash: cachedHash,
        },
      },
    });

    // Mock @google/genai generateContent
    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        category: 'CLI / Tools',
        confidence: 0.82,
        reasoning: 'Experimental sorting algorithm',
      }),
    });

    vi.doMock('@google/genai', () => {
      return {
        GoogleGenAI: vi.fn().mockImplementation(() => ({
          models: {
            generateContent: mockGenerateContent,
          },
        })),
      };
    });

    const phasesSeen: string[] = [];
    const result = await syncStarredRepos({
      token: 'ghp_test_token',
      store,
      gemini: {
        apiKey: 'test-gemini-key',
        minIntervalMs: 0,
      },
      onProgress: (p) => {
        phasesSeen.push(p.phase);
      },
    });

    expect(result.geminiStatus).toBe('ok');
    expect(result.envelope.repos).toHaveLength(3);

    // Verify Repo 1 was classified by rules
    const r1 = result.envelope.repos.find(r => r.name === 'react-widget');
    expect(r1?.category).toBe('Web Frontend');
    expect(r1?.classification.method).toBe('rule');

    // Verify Repo 2 was classified by Gemini
    const r2 = result.envelope.repos.find(r => r.name === 'quantum-sorter');
    expect(r2?.category).toBe('CLI / Tools');
    expect(r2?.classification.method).toBe('llm');

    // Verify Repo 3 was served from cache
    const r3 = result.envelope.repos.find(r => r.name === 'old-cached-tool');
    expect(r3?.category).toBe('CLI / Tools');

    // Gemini should only have been called ONCE (for ambiguousRepo)
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(phasesSeen).toContain('llm');

    // Verify stored data has NO Gemini API key
    const rawStored = JSON.stringify(await store.get('dataset'));
    expect(rawStored).not.toContain('test-gemini-key');
  });

  it('quota error: GeminiQuotaError causes fallback to Other, sync succeeds, status quota_exceeded', async () => {
    const ambiguous1 = {
      id: 201,
      name: 'ambiguous-1',
      full_name: 'octocat/ambiguous-1',
      owner: { login: 'octocat' },
      description: 'Ambiguous 1',
      topics: [],
      language: 'C',
      stargazers_count: 1,
      html_url: 'https://github.com/octocat/ambiguous-1',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const ambiguous2 = {
      id: 202,
      name: 'ambiguous-2',
      full_name: 'octocat/ambiguous-2',
      owner: { login: 'octocat' },
      description: 'Ambiguous 2',
      topics: [],
      language: 'C',
      stargazers_count: 1,
      html_url: 'https://github.com/octocat/ambiguous-2',
      updated_at: '2026-01-01T00:00:00Z',
    };

    setupMockGitHub([ambiguous1, ambiguous2]);

    const store = new MemoryStore();

    // Mock @google/genai generateContent throwing quota error
    const mockGenerateContent = vi.fn().mockRejectedValue({
      status: 429,
      message: 'RESOURCE_EXHAUSTED: quota exceeded',
    });

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent,
        },
      })),
    }));

    const result = await syncStarredRepos({
      token: 'ghp_test_token',
      store,
      gemini: {
        apiKey: 'test-gemini-key',
        minIntervalMs: 0,
      },
    });

    // Should complete successfully with quota_exceeded status
    expect(result.geminiStatus).toBe('quota_exceeded');
    expect(result.envelope.repos).toHaveLength(2);
    expect(result.envelope.repos[0].category).toBe('Other');
    expect(result.envelope.repos[0].classification.method).toBe('fallback');
    expect(result.envelope.repos[1].category).toBe('Other');
    expect(result.envelope.repos[1].classification.method).toBe('fallback');

    // Only called once because quota error disabled subsequent calls
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);

    // Verify key is not saved anywhere in stored dataset
    const savedDataset = await store.get('dataset');
    expect(JSON.stringify(savedDataset)).not.toContain('test-gemini-key');
  });

  it('reclassifyOther with ignoreOtherCache clears Other entries and calls Gemini', async () => {
    const ambiguousRepo = {
      id: 301,
      name: 'quantum-sorter-xyz',
      full_name: 'octocat/quantum-sorter-xyz',
      owner: { login: 'octocat' },
      description: 'An esoteric experiment',
      topics: [],
      language: 'Rust',
      stargazers_count: 10,
      html_url: 'https://github.com/octocat/quantum-sorter-xyz',
      updated_at: '2026-01-01T00:00:00Z',
    };

    setupMockGitHub([ambiguousRepo]);

    const store = new MemoryStore();
    const hash = computeInputHash({
      fullName: 'octocat/quantum-sorter-xyz',
      description: 'An esoteric experiment',
      topics: [],
      language: 'Rust',
    });

    // Pre-cache as 'Other'
    await store.set('classificationCache', {
      'octocat/quantum-sorter-xyz': {
        category: 'Other',
        classification: {
          method: 'fallback',
          confidence: 0.5,
          classifiedAt: '2026-01-01T00:00:00Z',
          inputHash: hash,
        },
      },
    });

    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        category: 'CLI / Tools',
        confidence: 0.85,
      }),
    });

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent,
        },
      })),
    }));

    // Run with ignoreOtherCache: true
    const result = await syncStarredRepos({
      token: 'ghp_test_token',
      store,
      ignoreOtherCache: true,
      gemini: {
        apiKey: 'test-gemini-key',
        minIntervalMs: 0,
      },
    });

    expect(result.geminiStatus).toBe('ok');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(result.envelope.repos[0].category).toBe('CLI / Tools');
    expect(result.envelope.repos[0].classification.method).toBe('llm');
  });

  it('abort during Gemini phase cancels sync and leaves previous dataset untouched', async () => {
    const ambiguous = {
      id: 401,
      name: 'ambiguous-abort',
      full_name: 'octocat/ambiguous-abort',
      owner: { login: 'octocat' },
      description: 'Ambiguous abort repo',
      topics: [],
      language: 'Python',
      stargazers_count: 10,
      html_url: 'https://github.com/octocat/ambiguous-abort',
      updated_at: '2026-01-01T00:00:00Z',
    };

    setupMockGitHub([ambiguous]);

    const store = new MemoryStore();
    const previousDataset = {
      schemaVersion: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      username: 'octocat',
      source: { type: 'github-stars' },
      repos: [],
    };
    await store.set('dataset', previousDataset);

    const controller = new AbortController();

    // Abort when generateContent is invoked
    const mockGenerateContent = vi.fn().mockImplementation(async () => {
      controller.abort();
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });

    vi.doMock('@google/genai', () => ({
      GoogleGenAI: vi.fn().mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent,
        },
      })),
    }));

    await expect(
      syncStarredRepos({
        token: 'ghp_test_token',
        store,
        signal: controller.signal,
        gemini: {
          apiKey: 'test-gemini-key',
          minIntervalMs: 0,
        },
      })
    ).rejects.toThrow();

    // Previous dataset should be intact
    const afterDataset = await store.get('dataset');
    expect(afterDataset).toEqual(previousDataset);
  });
});
