import { ALLOWED_CATEGORIES, type RepositoryCategory } from '../types/repo.ts';
import type { NormalizedRepo } from './normalize.ts';
import type { ClassificationResult } from './classifier.ts';
import {
  RateLimiter,
  executeWithRetry,
  extractRetryDelayMs,
  isRateLimitError,
} from './rate-limiter.ts';
import {
  type LLMProviderId,
  type LLMProviderDef,
  LLM_PROVIDERS,
  getLLMProvider,
  LLMProviderError,
  LLMRateLimitError,
  LLMAuthError,
  LLMError,
  isModelNotFoundError,
} from './llm-providers.ts';

export {
  type LLMProviderId,
  type LLMProviderDef,
  LLM_PROVIDERS,
  getLLMProvider,
  LLMProviderError,
  LLMRateLimitError,
  LLMAuthError,
  LLMError,
  isModelNotFoundError,
};

export const DEFAULT_LLM_PROVIDER: LLMProviderId = 'google';

export const PROVIDER_DEFAULTS: Record<
  LLMProviderId,
  { defaultModel: string; defaultIntervalSec: number }
> = {
  openai: {
    defaultModel: 'gpt-6-luna',
    defaultIntervalSec: 1,
  },
  anthropic: {
    defaultModel: 'claude-sonnet-5-5',
    defaultIntervalSec: 1,
  },
  google: {
    defaultModel: 'gemini-3.8-flash',
    defaultIntervalSec: 4,
  },
  deepseek: {
    defaultModel: 'deepseek-chat',
    defaultIntervalSec: 1,
  },
};

export { LLMRateLimitError as GeminiQuotaError };

export function buildClassificationPrompt(repo: NormalizedRepo): string {
  return `You are an expert software classifier. Categorize this GitHub repository into EXACTLY ONE of the following allowed categories:
${ALLOWED_CATEGORIES.map(c => `- "${c}"`).join('\n')}

Repository Details:
- Full Name: ${repo.fullName}
- Description: ${repo.description || 'None'}
- Primary Language: ${repo.language || 'Unknown'}
- Topics: ${repo.topics.join(', ') || 'None'}

Classification Rules:
1. Classify the repository based on its PRIMARY PURPOSE and ARTIFACT FORMAT, not merely its technical domain.
2. Note that "AI-related" does NOT automatically mean "ML / AI":
   - An educational tutorial, course, handbook, or list about AI is "Learning / Docs".
   - A developer tool, CLI utility, or converter utilizing AI is "CLI / Tools".
   - An interactive web application, UI, or visualizer is "Web Frontend".
   - An orchestration or workflow automation platform is "DevOps / Infra".
   - An API client or SDK wrapper is "Backend / API".
   - Only code that implements, trains, fine-tunes, or executes actual models/neural architectures is "ML / AI".
3. Respond with a valid JSON object containing "category" and "confidence" (number between 0.50 and 0.99).
4. Example JSON response: {"category": "Learning / Docs", "confidence": 0.88}`;
}

export function parseClassificationResponse(
  text: string
): { category: RepositoryCategory; confidence: number } | null {
  if (!text || typeof text !== 'string') return null;

  let cleaned = text.trim();
  // Strip markdown code fences if model returned ```json ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const rawCategory = typeof record.category === 'string' ? record.category.trim() : '';

  if (!ALLOWED_CATEGORIES.includes(rawCategory as RepositoryCategory)) {
    return null;
  }

  const rawConfidence =
    typeof record.confidence === 'number' && !Number.isNaN(record.confidence)
      ? record.confidence
      : typeof record.confidence === 'string'
      ? parseFloat(record.confidence)
      : 0.85;

  const validNum = Number.isNaN(rawConfidence) ? 0.85 : rawConfidence;
  // Clamps confidence to 0.5–0.99
  const clampedConfidence = Math.min(0.99, Math.max(0.5, Math.round(validNum * 100) / 100));

  return {
    category: rawCategory as RepositoryCategory,
    confidence: clampedConfidence,
  };
}

export interface LLMClassifierOptions {
  provider?: LLMProviderId;
  apiKey: string;
  model?: string;
  minIntervalMs?: number;
  adaptive?: boolean;
  onThrottle?: (waitMs: number) => void;
  signal?: AbortSignal;
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
  rateLimiter?: RateLimiter;
  allowModelHeal?: boolean;
  onModelFallback?: (pickedModel: string) => void;
}

export function createLLMClassifier(
  options: LLMClassifierOptions
): (repo: NormalizedRepo) => Promise<ClassificationResult> {
  const providerId: LLMProviderId = options.provider ?? DEFAULT_LLM_PROVIDER;
  const providerDef = getLLMProvider(providerId);

  const {
    apiKey,
    minIntervalMs = providerDef.defaultIntervalSec * 1000,
    adaptive = false,
    onThrottle,
    signal,
    sleepFn,
    maxRetries = 2,
    allowModelHeal = false,
    onModelFallback,
  } = options;

  let activeModel = options.model || providerDef.defaultModel;
  let hasHealed = false;

  const startInterval = minIntervalMs;
  let currentInterval = startInterval;

  const rateLimiter = options.rateLimiter ?? new RateLimiter({ minIntervalMs: currentInterval });
  if (adaptive) {
    rateLimiter.setMinIntervalMs(currentInterval);
  }

  return async (repo: NormalizedRepo): Promise<ClassificationResult> => {
    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw signal.reason || err;
    }

    const prompt = buildClassificationPrompt(repo);

    const callWithModel = async (modelToUse: string): Promise<string> => {
      return executeWithRetry(
        async () => {
          if (signal?.aborted) {
            const err = new Error('Operation aborted');
            err.name = 'AbortError';
            throw signal.reason || err;
          }

          try {
            return await providerDef.classify({
              apiKey,
              model: modelToUse,
              prompt,
              signal,
            });
          } catch (err) {
            if (isRateLimitError(err) || err instanceof LLMRateLimitError) {
              const retryAfterSec =
                typeof (err as { retryAfterSec?: number }).retryAfterSec === 'number' &&
                (err as { retryAfterSec?: number }).retryAfterSec! > 0
                  ? (err as { retryAfterSec?: number }).retryAfterSec!
                  : undefined;
              const serverDelayMs = extractRetryDelayMs(err);
              const waitMs = retryAfterSec ? retryAfterSec * 1000 : (serverDelayMs ?? 15000);
              onThrottle?.(waitMs);
              if (adaptive) {
                currentInterval = startInterval;
                rateLimiter.setMinIntervalMs(currentInterval);
              }
            }
            throw err;
          }
        },
        {
          rateLimiter,
          maxRetries,
          sleepFn,
          signal,
        }
      );
    };

    let responseText: string;
    try {
      responseText = await callWithModel(activeModel);
    } catch (err) {
      if (signal?.aborted) {
        const abortErr = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        throw signal.reason || abortErr;
      }

      if (allowModelHeal && !hasHealed && isModelNotFoundError(err)) {
        hasHealed = true;
        let pickedModel: string | null = null;
        try {
          const models = await providerDef.listModels({ apiKey, signal });
          if (signal?.aborted) {
            const abortErr = new Error('Operation aborted');
            abortErr.name = 'AbortError';
            throw signal.reason || abortErr;
          }
          pickedModel = providerDef.pickPreferredModel(models);
        } catch (listErr) {
          if (signal?.aborted) throw listErr;
          throw err;
        }

        if (pickedModel && pickedModel !== activeModel) {
          activeModel = pickedModel;
          try {
            responseText = await callWithModel(activeModel);
            onModelFallback?.(pickedModel);
          } catch (retryErr) {
            if (signal?.aborted) throw retryErr;
            throw err;
          }
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    if (adaptive && currentInterval > 1500) {
      currentInterval = Math.max(1500, currentInterval - 500);
      rateLimiter.setMinIntervalMs(currentInterval);
    }

    const parsed = parseClassificationResponse(responseText);
    if (parsed) {
      return {
        category: parsed.category,
        method: 'llm',
        confidence: parsed.confidence,
      };
    }

    return {
      category: 'Other',
      method: 'fallback',
      confidence: 0.5,
    };
  };
}

export interface GeminiClassifierOptions extends Omit<LLMClassifierOptions, 'provider'> {
  provider?: LLMProviderId;
}

export function createGeminiClassifier(
  options: GeminiClassifierOptions
): (repo: NormalizedRepo) => Promise<ClassificationResult> {
  return createLLMClassifier({
    ...options,
    provider: options.provider ?? 'google',
  });
}
