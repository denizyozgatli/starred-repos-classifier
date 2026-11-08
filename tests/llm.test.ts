import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildClassificationPrompt,
  parseClassificationResponse,
  createLLMClassifier,
  PROVIDER_DEFAULTS,
  DEFAULT_LLM_PROVIDER,
  LLMRateLimitError,
  LLMAuthError,
  getLLMProvider,
  LLM_PROVIDERS,
  type LLMProviderId,
  isModelNotFoundError,
} from '../src/core/llm.ts';
import {
  RateLimiter,
  executeWithRetry,
} from '../src/core/rate-limiter.ts';
import {
  saveGeminiKey,
  loadGeminiKey,
  clearGeminiKey,
  isGeminiKeyRemembered,
  saveGeminiSettings,
  loadGeminiSettings,
  loadLlmSettings,
  saveLlmSettings,
  clearLlmKey,
  detectProvider,
  createDefaultLlmSettings,
  isModelAuto,
  setModelAuto,
} from '../src/lib/storage/settings.ts';
import { MemoryStore } from '../src/lib/storage/datasetStore.ts';
import { syncStarredRepos } from '../src/lib/sync.ts';
import type { NormalizedRepo } from '../src/core/normalize.ts';

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

describe('LLM & Multi-Provider Core (src/core/llm.ts & src/core/llm-providers.ts)', () => {
  describe('Provider Registry & Defaults', () => {
    it('configures default provider as google and exports provider defaults', () => {
      expect(DEFAULT_LLM_PROVIDER).toBe('google');
      expect(PROVIDER_DEFAULTS.google.defaultModel).toBe('gemini-3.8-flash');
      expect(PROVIDER_DEFAULTS.openai.defaultModel).toBe('gpt-6-luna');
      expect(PROVIDER_DEFAULTS.anthropic.defaultModel).toBe('claude-sonnet-5-5');
      expect(PROVIDER_DEFAULTS.deepseek.defaultModel).toBe('deepseek-chat');
    });

    it('retrieves all 4 supported providers by ID', () => {
      const providers: LLMProviderId[] = ['openai', 'anthropic', 'google', 'deepseek'];
      for (const id of providers) {
        const def = getLLMProvider(id);
        expect(def.id).toBe(id);
        expect(def.label).toBeTruthy();
        expect(def.defaultModel).toBeTruthy();
        expect(def.defaultIntervalSec).toBeGreaterThan(0);
      }
    });

    it('validates provider key patterns as hints', () => {
      expect(LLM_PROVIDERS.openai.keyPattern.test('sk-proj-12345')).toBe(true);
      expect(LLM_PROVIDERS.openai.keyPattern.test('sk-ant-12345')).toBe(false);

      expect(LLM_PROVIDERS.anthropic.keyPattern.test('sk-ant-api03-123')).toBe(true);
      expect(LLM_PROVIDERS.anthropic.keyPattern.test('sk-openai-123')).toBe(false);

      expect(LLM_PROVIDERS.google.keyPattern.test('AIzaSyD-12345')).toBe(true);
      expect(LLM_PROVIDERS.google.keyPattern.test('sk-12345')).toBe(false);

      expect(LLM_PROVIDERS.deepseek.keyPattern.test('sk-deepseek-123')).toBe(true);
    });

    it('implements pickPreferredModel for all 4 providers', () => {
      // Google: first with 'flash'
      expect(LLM_PROVIDERS.google.pickPreferredModel(['gemini-2.5-pro', 'gemini-3.8-flash', 'gemini-1.5-pro'])).toBe('gemini-3.8-flash');
      expect(LLM_PROVIDERS.google.pickPreferredModel(['gemini-pro', 'custom-model'])).toBeNull();

      // OpenAI: first matching /^gpt-6/ then /mini/
      expect(LLM_PROVIDERS.openai.pickPreferredModel(['gpt-4o', 'gpt-6-luna', 'gpt-4o-mini'])).toBe('gpt-6-luna');
      expect(LLM_PROVIDERS.openai.pickPreferredModel(['gpt-4o', 'gpt-4o-mini', 'o1'])).toBe('gpt-4o-mini');
      expect(LLM_PROVIDERS.openai.pickPreferredModel(['o1', 'o3', 'text-davinci'])).toBeNull();

      // Anthropic: first containing 'sonnet'
      expect(LLM_PROVIDERS.anthropic.pickPreferredModel(['claude-3-5-haiku', 'claude-sonnet-5-5'])).toBe('claude-sonnet-5-5');
      expect(LLM_PROVIDERS.anthropic.pickPreferredModel(['claude-3-opus', 'claude-haiku'])).toBeNull();

      // DeepSeek: 'deepseek-chat' if present
      expect(LLM_PROVIDERS.deepseek.pickPreferredModel(['deepseek-coder', 'deepseek-chat'])).toBe('deepseek-chat');
      expect(LLM_PROVIDERS.deepseek.pickPreferredModel(['deepseek-reasoner'])).toBeNull();
    });

    it('detects model not found errors with isModelNotFoundError', () => {
      expect(isModelNotFoundError({ status: 404 })).toBe(true);
      expect(isModelNotFoundError({ code: 'model_not_found' })).toBe(true);
      expect(isModelNotFoundError({ code: 'not_found_error' })).toBe(true);
      expect(isModelNotFoundError({ code: 'NOT_FOUND' })).toBe(true);
      expect(isModelNotFoundError({ message: 'The model `foo` was not found' })).toBe(true);
      expect(isModelNotFoundError({ status: 500, message: 'Internal Server Error' })).toBe(false);
      expect(isModelNotFoundError(null)).toBe(false);
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
      const raw = '```json\n{\n  "category": "DevOps / Infra",\n  "confidence": 0.92\n}\n```';
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
    it('RateLimiter spaces out consecutive calls to minimum interval', async () => {
      let currentTime = 1000;
      const sleepDelays: number[] = [];

      const mockSleep = async (ms: number) => {
        sleepDelays.push(ms);
        currentTime += ms;
      };

      vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

      const limiter = new RateLimiter({ minIntervalMs: 4000, sleepFn: mockSleep });

      // First call: immediate
      await limiter.acquire(mockSleep);
      expect(sleepDelays).toHaveLength(0);

      // Advance by 1500ms
      currentTime += 1500;

      // Second call: should wait 4000 - 1500 = 2500ms
      await limiter.acquire(mockSleep);
      expect(sleepDelays).toHaveLength(1);
      expect(sleepDelays[0]).toBe(2500);

      vi.restoreAllMocks();
    });

    it('executeWithRetry retries on 429 and succeeds when retry returns valid result', async () => {
      let attempts = 0;
      const result = await executeWithRetry(
        async () => {
          attempts++;
          if (attempts === 1) {
            throw new LLMRateLimitError('openai', 'Rate limit exceeded', { retryAfterSec: 1 });
          }
          return 'success';
        },
        {
          maxRetries: 2,
          sleepFn: async () => {},
        }
      );

      expect(attempts).toBe(2);
      expect(result).toBe('success');
    });

    it('executeWithRetry throws LLMAuthError immediately without retrying', async () => {
      let attempts = 0;
      await expect(
        executeWithRetry(
          async () => {
            attempts++;
            throw new LLMAuthError('anthropic', 'Invalid API key');
          },
          {
            maxRetries: 2,
            sleepFn: async () => {},
          }
        )
      ).rejects.toBeInstanceOf(LLMAuthError);

      expect(attempts).toBe(1);
    });
  });

  describe('Provider Wire Formats & Happy Paths (Fetch-based)', () => {
    const originalFetch = globalThis.fetch;
    const sampleRepo: NormalizedRepo = {
      id: 1,
      name: 'ambiguous-tool',
      fullName: 'org/ambiguous-tool',
      owner: 'org',
      description: 'An ambiguous CLI converter',
      topics: ['cli'],
      language: 'Rust',
      stars: 100,
      url: 'https://github.com/org/ambiguous-tool',
      updatedAt: '2026-01-01T00:00:00Z',
      archived: false,
      fork: false,
    };

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('openai: posts to /chat/completions with json_object format and Bearer auth', async () => {
      let requestedUrl = '';
      let requestedHeaders: Headers | undefined;
      let requestedBody: Record<string, unknown> | undefined;

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        requestedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ category: 'CLI / Tools', confidence: 0.95 }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const classifier = createLLMClassifier({
        provider: 'openai',
        apiKey: 'sk-test-secret-key-123',
        model: 'gpt-4o-mini',
        minIntervalMs: 0,
      });

      const result = await classifier(sampleRepo);
      expect(result.category).toBe('CLI / Tools');
      expect(result.method).toBe('llm');
      expect(result.confidence).toBe(0.95);

      expect(requestedUrl).toBe('https://api.openai.com/v1/chat/completions');
      expect(requestedHeaders?.get('authorization')).toBe('Bearer sk-test-secret-key-123');
      expect(requestedHeaders?.get('content-type')).toBe('application/json');
      expect(requestedBody?.model).toBe('gpt-4o-mini');
      expect(requestedBody?.response_format).toEqual({ type: 'json_object' });
      expect(requestedBody?.reasoning_effort).toBeUndefined();
    });

    it('openai: adds reasoning_effort: "none" only when model starts with gpt-6', async () => {
      let requestedBody: Record<string, unknown> | undefined;

      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ category: 'ML / AI', confidence: 0.99 }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const classifier = createLLMClassifier({
        provider: 'openai',
        apiKey: 'sk-test-secret',
        model: 'gpt-6-luna',
        minIntervalMs: 0,
      });

      const result = await classifier(sampleRepo);
      expect(result.category).toBe('ML / AI');
      expect(requestedBody?.model).toBe('gpt-6-luna');
      expect(requestedBody?.reasoning_effort).toBe('none');
    });

    it('openai: retries once without response_format if 400 mentions response_format', async () => {
      let calls = 0;
      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        if (calls === 1) {
          expect(body.response_format).toBeDefined();
          return new Response(
            JSON.stringify({ error: { message: 'response_format is not supported by this model' } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        expect(body.response_format).toBeUndefined();
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ category: 'Backend / API', confidence: 0.9 }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const classifier = createLLMClassifier({
        provider: 'openai',
        apiKey: 'sk-test-secret',
        minIntervalMs: 0,
      });

      const result = await classifier(sampleRepo);
      expect(calls).toBe(2);
      expect(result.category).toBe('Backend / API');
    });

    it('anthropic: posts to /messages with custom headers and x-api-key', async () => {
      let requestedUrl = '';
      let requestedHeaders: Headers | undefined;
      let requestedBody: Record<string, unknown> | undefined;

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        requestedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: JSON.stringify({ category: 'ML / AI', confidence: 0.92 }),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const classifier = createLLMClassifier({
        provider: 'anthropic',
        apiKey: 'sk-ant-api03-test-token',
        minIntervalMs: 0,
      });

      const result = await classifier(sampleRepo);
      expect(result.category).toBe('ML / AI');
      expect(requestedUrl).toBe('https://api.anthropic.com/v1/messages');
      expect(requestedHeaders?.get('x-api-key')).toBe('sk-ant-api03-test-token');
      expect(requestedHeaders?.get('anthropic-version')).toBe('2023-06-01');
      expect(requestedHeaders?.get('anthropic-dangerous-direct-browser-access')).toBe('true');
      expect(requestedBody?.max_tokens).toBe(1024);
    });

    it('deepseek: posts to /chat/completions without response_format', async () => {
      let requestedUrl = '';
      let requestedHeaders: Headers | undefined;
      let requestedBody: Record<string, unknown> | undefined;

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        requestedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ category: 'Web Frontend', confidence: 0.88 }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const classifier = createLLMClassifier({
        provider: 'deepseek',
        apiKey: 'sk-deepseek-key',
        minIntervalMs: 0,
      });

      const result = await classifier(sampleRepo);
      expect(result.category).toBe('Web Frontend');
      expect(requestedUrl).toBe('https://api.deepseek.com/chat/completions');
      expect(requestedHeaders?.get('authorization')).toBe('Bearer sk-deepseek-key');
      expect(requestedBody?.response_format).toBeUndefined();
    });

    it('google: posts to /models/{model}:generateContent with apiKey query param', async () => {
      let requestedUrl = '';
      let requestedBody: Record<string, unknown> | undefined;

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ category: 'DevOps / Infra', confidence: 0.94 }) }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const classifier = createLLMClassifier({
        provider: 'google',
        apiKey: 'AIzaSyFakeKey123',
        model: 'gemini-3.8-flash',
        minIntervalMs: 0,
      });

      const result = await classifier(sampleRepo);
      expect(result.category).toBe('DevOps / Infra');
      expect(requestedUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=AIzaSyFakeKey123'
      );
      expect(requestedBody?.generationConfig).toEqual({
        temperature: 0,
        responseMimeType: 'application/json',
      });
    });

    it('self-heals when model is not found (404): fetches listModels, retries with preferred model, and invokes onModelFallback once', async () => {
      const callLog: string[] = [];
      const fallbackCalls: string[] = [];

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        // 1. Initial classify request with retired model -> 404 NOT_FOUND
        if (url.includes(':generateContent') && url.includes('retired-gemini-model')) {
          callLog.push('initial-classify-retired');
          return new Response(
            JSON.stringify({
              error: {
                code: 404,
                message: 'models/retired-gemini-model is not found for API version v1beta',
                status: 'NOT_FOUND',
              },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // 2. Self-healing listModels call
        if (url.includes('/v1beta/models') && !url.includes(':generateContent')) {
          callLog.push('list-models');
          return new Response(
            JSON.stringify({
              models: [
                { name: 'models/gemini-2.0-pro', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // 3. Retried classify call with picked model (gemini-3.8-flash) -> 200 OK
        if (url.includes(':generateContent') && url.includes('gemini-3.8-flash')) {
          callLog.push('retry-classify-picked');
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify({ category: 'Web Frontend', confidence: 0.95 }) }],
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        throw new Error(`Unexpected request to ${url}`);
      });

      const classifier = createLLMClassifier({
        provider: 'google',
        apiKey: 'AIzaSyTestKey',
        model: 'retired-gemini-model',
        allowModelHeal: true,
        onModelFallback: (model: string) => {
          fallbackCalls.push(model);
        },
        minIntervalMs: 0,
      });

      const result = await classifier(sampleRepo);
      expect(result.category).toBe('Web Frontend');
      expect(result.confidence).toBe(0.95);
      expect(callLog).toEqual(['initial-classify-retired', 'list-models', 'retry-classify-picked']);
      expect(fallbackCalls).toEqual(['gemini-3.8-flash']);
    });

    it('does not attempt model healing when allowModelHeal is false', async () => {
      let fetchCount = 0;
      globalThis.fetch = vi.fn(async () => {
        fetchCount++;
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: 'model not found',
              status: 'NOT_FOUND',
            },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const classifier = createLLMClassifier({
        provider: 'google',
        apiKey: 'AIzaSyTestKey',
        model: 'unknown-model',
        allowModelHeal: false,
        minIntervalMs: 0,
      });

      await expect(classifier(sampleRepo)).rejects.toThrow();
      expect(fetchCount).toBe(1);
    });

    it('ensures API key is NEVER included in error messages when an API error occurs', async () => {
      const secretKey = 'sk-extremely-secret-key-xyz999';

      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: { message: `Request with key ${secretKey} was rejected` },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const classifier = createLLMClassifier({
        provider: 'openai',
        apiKey: secretKey,
        minIntervalMs: 0,
        maxRetries: 0,
      });

      await expect(classifier(sampleRepo)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(LLMAuthError);
        const errorMsg = (err as Error).message;
        expect(errorMsg).not.toContain(secretKey);
        expect(errorMsg).toContain('[REDACTED]');
        return true;
      });
    });
  });

  describe('listModels Filtering per Provider', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('openai: filters for gpt-, o1-, o3-, o4-, chatgpt- models and sorts descending', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'dall-e-3' },
              { id: 'whisper-1' },
              { id: 'gpt-3.5-turbo' },
              { id: 'gpt-4o' },
              { id: 'gpt-4o-mini' },
              { id: 'o1-preview' },
              { id: 'o3-mini' },
              { id: 'text-embedding-3-small' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const models = await LLM_PROVIDERS.openai.listModels({ apiKey: 'sk-test' });
      expect(models).toEqual(['o3-mini', 'o1-preview', 'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo']);
      expect(models).not.toContain('dall-e-3');
      expect(models).not.toContain('whisper-1');
      expect(models).not.toContain('text-embedding-3-small');
    });

    it('google: filters for supportedGenerationMethods containing generateContent and strips models/ prefix', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
              { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const models = await LLM_PROVIDERS.google.listModels({ apiKey: 'AIza-test' });
      expect(models).toEqual(['gemini-2.5-flash', 'gemini-3.8-flash']);
      expect(models).not.toContain('text-embedding-004');
    });

    it('deepseek: returns model list from /models', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const models = await LLM_PROVIDERS.deepseek.listModels({ apiKey: 'sk-deepseek' });
      expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    });

    it('anthropic: returns model list from /models', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            data: [{ id: 'claude-3-5-sonnet-20241022' }, { id: 'claude-3-5-haiku-20241022' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const models = await LLM_PROVIDERS.anthropic.listModels({ apiKey: 'sk-ant-test' });
      expect(models).toEqual(['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022']);
    });
  });

  describe('Storage & Settings', () => {
    let mockSession: MockStorage;
    let mockLocal: MockStorage;

    beforeEach(() => {
      mockSession = new MockStorage();
      mockLocal = new MockStorage();
      vi.stubGlobal('sessionStorage', mockSession);
      vi.stubGlobal('localStorage', mockLocal);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    describe('detectProvider', () => {
      it('detects google from AIza prefix', () => {
        expect(detectProvider('AIzaSyD-1234567890abcdef')).toBe('google');
      });

      it('detects anthropic from sk-ant- prefix', () => {
        expect(detectProvider('sk-ant-api03-abcdef12345')).toBe('anthropic');
      });

      it('returns null for ambiguous sk- keys (OpenAI vs DeepSeek)', () => {
        expect(detectProvider('sk-proj-1234567890')).toBeNull();
        expect(detectProvider('sk-deepseek-12345')).toBeNull();
        expect(detectProvider('sk-12345')).toBeNull();
      });

      it('returns null for empty or unrecognized keys', () => {
        expect(detectProvider('')).toBeNull();
        expect(detectProvider('   ')).toBeNull();
        expect(detectProvider('ghp_github_token_12345')).toBeNull();
      });
    });

    describe('Provider-Aware Settings Schema & Persistence', () => {
      it('loads default settings when storage is empty with modelAuto default true', () => {
        const settings = loadLlmSettings();
        expect(settings.provider).toBe('google');
        expect(settings.providers.openai.model).toBe('gpt-6-luna');
        expect(settings.providers.openai.modelAuto).toBe(true);
        expect(isModelAuto(settings, 'openai')).toBe(true);
        expect(settings.providers.anthropic.model).toBe('claude-sonnet-5-5');
        expect(settings.providers.anthropic.modelAuto).toBe(true);
        expect(settings.providers.google.model).toBe('gemini-3.8-flash');
        expect(settings.providers.google.modelAuto).toBe(true);
        expect(settings.providers.deepseek.model).toBe('deepseek-chat');
        expect(settings.providers.deepseek.modelAuto).toBe(true);
        expect(settings.providers.openai.intervalSec).toBeNull();
      });

      it('supports isModelAuto and setModelAuto helpers', () => {
        let settings = createDefaultLlmSettings();
        expect(isModelAuto(settings, 'google')).toBe(true);
        settings = setModelAuto(settings, 'google', false);
        expect(isModelAuto(settings, 'google')).toBe(false);
        expect(settings.providers.google.modelAuto).toBe(false);
      });

      it('persists and roundtrips multi-provider settings with remember flags', () => {
        const settings = createDefaultLlmSettings();
        settings.provider = 'anthropic';
        // Google remembered with custom model and modelAuto false
        settings.providers.google = {
          apiKey: 'AIzaSyGoogleKey',
          model: 'gemini-3.8-flash',
          modelAuto: false,
          intervalSec: 4.5,
          remember: true,
        };
        // OpenAI session-only
        settings.providers.openai = {
          apiKey: 'sk-proj-OpenAiKey',
          model: 'gpt-6-luna',
          modelAuto: true,
          intervalSec: 1.5,
          remember: false,
        };

        saveLlmSettings(settings);

        // Verify physical storage segregation
        const rawLocal = JSON.parse(mockLocal.getItem('starred_repos_llm_settings') || '{}');
        const rawSession = JSON.parse(mockSession.getItem('starred_repos_llm_settings') || '{}');

        // Remembered key in localStorage, stripped from sessionStorage
        expect(rawLocal.providers.google.apiKey).toBe('AIzaSyGoogleKey');
        expect(rawLocal.providers.google.modelAuto).toBe(false);
        expect(rawSession.providers.google.apiKey).toBe('');

        // Non-remembered key in sessionStorage, stripped from localStorage
        expect(rawSession.providers.openai.apiKey).toBe('sk-proj-OpenAiKey');
        expect(rawLocal.providers.openai.apiKey).toBe('');
        expect(rawLocal.providers.openai.modelAuto).toBe(true);

        // Reload and assert merged result
        const loaded = loadLlmSettings();
        expect(loaded.provider).toBe('anthropic');
        expect(loaded.providers.google.apiKey).toBe('AIzaSyGoogleKey');
        expect(loaded.providers.google.modelAuto).toBe(false);
        expect(loaded.providers.google.intervalSec).toBe(4.5);
        expect(loaded.providers.google.remember).toBe(true);

        expect(loaded.providers.openai.apiKey).toBe('sk-proj-OpenAiKey');
        expect(loaded.providers.openai.modelAuto).toBe(true);
        expect(loaded.providers.openai.intervalSec).toBe(1.5);
        expect(loaded.providers.openai.remember).toBe(false);
      });

      it('clears specific provider key from storage without affecting others', () => {
        const settings = createDefaultLlmSettings();
        settings.providers.google.apiKey = 'AIzaSyGoogle';
        settings.providers.google.remember = true;
        settings.providers.anthropic.apiKey = 'sk-ant-Claude';
        settings.providers.anthropic.remember = false;
        saveLlmSettings(settings);

        clearLlmKey('google');

        const reloaded = loadLlmSettings();
        expect(reloaded.providers.google.apiKey).toBe('');
        expect(reloaded.providers.google.remember).toBe(false);
        expect(reloaded.providers.anthropic.apiKey).toBe('sk-ant-Claude');
      });
    });

    describe('Legacy Settings Migration', () => {
      it('migrates old single-Gemini keys into providers.google and deletes old keys, keeping modelAuto=false when model exists', () => {
        mockLocal.setItem('starred_repos_gemini_key', 'AIzaSyLegacyKey');
        mockLocal.setItem('starred_repos_gemini_model', 'custom-gemini-model');
        mockLocal.setItem('starred_repos_gemini_interval', '5.5');

        const migrated = loadLlmSettings();
        expect(migrated.provider).toBe('google');
        expect(migrated.providers.google.apiKey).toBe('AIzaSyLegacyKey');
        expect(migrated.providers.google.model).toBe('custom-gemini-model');
        expect(migrated.providers.google.modelAuto).toBe(false);
        expect(migrated.providers.google.intervalSec).toBe(5.5);
        expect(migrated.providers.google.remember).toBe(true);

        // Old keys must be deleted
        expect(mockLocal.getItem('starred_repos_gemini_key')).toBeNull();
        expect(mockLocal.getItem('starred_repos_gemini_model')).toBeNull();
        expect(mockLocal.getItem('starred_repos_gemini_interval')).toBeNull();
      });
    });

    describe('Deprecated Legacy Wrappers', () => {
      it('saves Gemini key to sessionStorage by default', () => {
        saveGeminiKey('AIzaSyDefault', false);
        expect(loadGeminiKey()).toBe('AIzaSyDefault');
        expect(isGeminiKeyRemembered()).toBe(false);
      });

      it('saves Gemini key to localStorage when remembered', () => {
        saveGeminiKey('AIzaSyRemembered', true);
        expect(loadGeminiKey()).toBe('AIzaSyRemembered');
        expect(isGeminiKeyRemembered()).toBe(true);
      });

      it('clears Gemini key from both storage locations', () => {
        saveGeminiKey('AIzaSyTemp', true);
        clearGeminiKey();
        expect(loadGeminiKey()).toBeNull();
      });

      it('saves and loads model and interval settings', () => {
        saveGeminiSettings({ model: 'custom-model', intervalSec: 2.5 });
        expect(loadGeminiSettings()).toEqual({ model: 'custom-model', intervalSec: 2.5 });
      });
    });
  });

  describe('Hybrid Sync Integration (src/lib/sync.ts)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    const setupMockGitHub = (repos: unknown[]) => {
      return (input: RequestInfo | URL, _init?: RequestInit) => {
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
        return null;
      };
    };

    it('invalid key: LLMAuthError sets llmStatus to invalid_key and classifies remaining as Other without failing sync', async () => {
      const ambiguousRepo = {
        id: 101,
        name: 'ambiguous-repo',
        full_name: 'octocat/ambiguous-repo',
        owner: { login: 'octocat' },
        description: 'An ambiguous repo without matched keywords',
        topics: [],
        language: 'C++',
        stargazers_count: 10,
        html_url: 'https://github.com/octocat/ambiguous-repo',
        updated_at: '2026-01-01T00:00:00Z',
      };

      const gitHubHandler = setupMockGitHub([ambiguousRepo]);

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const gh = gitHubHandler(input, init);
        if (gh) return gh;

        // LLM call returns 401 unauthorized
        return new Response(
          JSON.stringify({ error: { message: 'Incorrect API key provided' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const store = new MemoryStore();
      const result = await syncStarredRepos({
        token: 'ghp_test_token',
        store,
        llm: {
          provider: 'openai',
          apiKey: 'sk-invalid-key',
        },
      });

      expect(result.llmStatus).toBe('invalid_key');
      expect(result.envelope.repos).toHaveLength(1);
      expect(result.envelope.repos[0].category).toBe('Other');
      expect(result.envelope.repos[0].classification.method).toBe('fallback');
    });

    it('quota exceeded: 429 sets llmStatus to quota_exceeded and avoids subsequent calls', async () => {
      const ambiguous1 = {
        id: 201,
        name: 'ambiguous-1',
        full_name: 'octocat/ambiguous-1',
        owner: { login: 'octocat' },
        description: 'Ambiguous 1',
        topics: [],
        language: 'Rust',
        stargazers_count: 5,
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

      const gitHubHandler = setupMockGitHub([ambiguous1, ambiguous2]);
      let llmCalls = 0;

      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const gh = gitHubHandler(input, init);
        if (gh) return gh;

        llmCalls++;
        return new Response(
          JSON.stringify({ error: { message: 'Rate limit exceeded: quota exhausted' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const store = new MemoryStore();
      const result = await syncStarredRepos({
        token: 'ghp_test_token',
        store,
        llm: {
          provider: 'google',
          apiKey: 'AIza-test-quota',
          minIntervalMs: 0,
        },
      });

      expect(result.llmStatus).toBe('quota_exceeded');
      expect(result.envelope.repos).toHaveLength(2);
      expect(result.envelope.repos[0].category).toBe('Other');
      expect(result.envelope.repos[1].category).toBe('Other');
    });
  });
});
