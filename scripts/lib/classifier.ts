import type { NormalizedRepo } from './normalize.ts';
import { RateLimiter } from './rate-limiter.ts';
import {
  tokenizeRepoName,
  normalizeTopic,
  scoreDomainsWithSaturation,
  scoreIntents,
  classifyWithRulesDebug,
  classifyWithRules,
  type DomainType,
  type IntentType,
  type ClassificationResult,
  type RuleDebugInfo,
  type ClassificationDebugResult,
} from '../../src/core/classifier.ts';
import {
  PROVIDER_DEFAULTS,
  DEFAULT_LLM_PROVIDER,
  GeminiQuotaError,
  buildClassificationPrompt,
  parseClassificationResponse,
  createLLMClassifier,
  createGeminiClassifier,
  type LLMClassifierOptions,
  type GeminiClassifierOptions,
  type LLMProviderId,
} from '../../src/core/llm.ts';

export {
  tokenizeRepoName,
  normalizeTopic,
  scoreDomainsWithSaturation,
  scoreIntents,
  classifyWithRulesDebug,
  classifyWithRules,
  PROVIDER_DEFAULTS,
  DEFAULT_LLM_PROVIDER,
  GeminiQuotaError,
  buildClassificationPrompt,
  parseClassificationResponse,
  createLLMClassifier,
  createGeminiClassifier,
  type DomainType,
  type IntentType,
  type ClassificationResult,
  type RuleDebugInfo,
  type ClassificationDebugResult,
  type LLMClassifierOptions,
  type GeminiClassifierOptions,
  type LLMProviderId,
};

export interface LLMClassificationOptions {
  provider?: LLMProviderId;
  apiKey?: string;
  model?: string;
  rateLimiter?: RateLimiter;
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

/**
 * Classifies an ambiguous repository using an LLM provider.
 * Falls back to "Other" with method: 'fallback' if no API key is provided or if an error occurs.
 * Reads environment variables:
 * - LLM_PROVIDER (openai|anthropic|google|deepseek, default 'google')
 * - LLM_API_KEY (fallback: GEMINI_API_KEY for provider google)
 * - LLM_MODEL (optional)
 * - LLM_INTERVAL_SEC (optional)
 */
export async function classifyWithLLM(
  repo: NormalizedRepo,
  optionsOrKey?: string | LLMClassificationOptions
): Promise<ClassificationResult> {
  const options: LLMClassificationOptions = typeof optionsOrKey === 'string'
    ? { apiKey: optionsOrKey }
    : optionsOrKey || {};

  const rawProvider = (options.provider || process.env.LLM_PROVIDER || DEFAULT_LLM_PROVIDER).toLowerCase() as LLMProviderId;
  const provider: LLMProviderId = (['openai', 'anthropic', 'google', 'deepseek'].includes(rawProvider))
    ? rawProvider
    : 'google';

  const key = options.apiKey || process.env.LLM_API_KEY || (provider === 'google' ? process.env.GEMINI_API_KEY : undefined);
  if (!key) {
    return {
      category: 'Other',
      method: 'fallback',
      confidence: 0.5,
    };
  }

  const model = options.model || process.env.LLM_MODEL || PROVIDER_DEFAULTS[provider].defaultModel;
  const intervalSec = process.env.LLM_INTERVAL_SEC
    ? parseFloat(process.env.LLM_INTERVAL_SEC)
    : PROVIDER_DEFAULTS[provider].defaultIntervalSec;
  const minIntervalMs = intervalSec * 1000;

  const rateLimiter = options.rateLimiter !== undefined ? options.rateLimiter : new RateLimiter({ minIntervalMs });
  const maxRetries = options.maxRetries ?? 2;
  const sleepFn = options.sleepFn;
  const signal = options.signal;

  const classifier = createLLMClassifier({
    provider,
    apiKey: key,
    model,
    minIntervalMs,
    rateLimiter,
    maxRetries,
    sleepFn,
    signal,
  });

  try {
    return await classifier(repo);
  } catch (error) {
    console.warn(`[classifier] LLM classification failed for ${repo.fullName}:`, error);
    return {
      category: 'Other',
      method: 'fallback',
      confidence: 0.5,
    };
  }
}

/**
 * Classifies a repository using rules first, and falls back to LLM if rules return null.
 * Incremental caching happens at the caller stage (classify.ts or sync.ts).
 */
export async function classifyRepo(
  repo: NormalizedRepo,
  optionsOrKey?: string | LLMClassificationOptions
): Promise<ClassificationResult> {
  const ruleResult = classifyWithRules(repo);
  if (ruleResult) {
    return ruleResult;
  }
  return classifyWithLLM(repo, optionsOrKey);
}
