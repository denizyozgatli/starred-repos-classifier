import type { NormalizedRepo } from './normalize.ts';
import { RateLimiter, defaultGeminiRateLimiter } from './rate-limiter.ts';
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
  GEMINI_MODEL,
  GeminiQuotaError,
  buildClassificationPrompt,
  parseClassificationResponse,
  createGeminiClassifier,
  type GeminiClassifierOptions,
} from '../../src/core/llm.ts';

export {
  tokenizeRepoName,
  normalizeTopic,
  scoreDomainsWithSaturation,
  scoreIntents,
  classifyWithRulesDebug,
  classifyWithRules,
  GEMINI_MODEL,
  GeminiQuotaError,
  buildClassificationPrompt,
  parseClassificationResponse,
  createGeminiClassifier,
  type DomainType,
  type IntentType,
  type ClassificationResult,
  type RuleDebugInfo,
  type ClassificationDebugResult,
  type GeminiClassifierOptions,
};

export interface LLMClassificationOptions {
  apiKey?: string;
  rateLimiter?: RateLimiter;
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

/**
 * Classifies an ambiguous repository using the Gemini LLM.
 * Falls back to "Other" with method: 'fallback' if no API key is provided or if an error occurs.
 * Thin Node wrapper around src/core/llm.ts using process.env.GEMINI_API_KEY.
 */
export async function classifyWithLLM(
  repo: NormalizedRepo,
  optionsOrKey?: string | LLMClassificationOptions
): Promise<ClassificationResult> {
  const options: LLMClassificationOptions = typeof optionsOrKey === 'string'
    ? { apiKey: optionsOrKey }
    : optionsOrKey || {};

  const key = options.apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      category: 'Other',
      method: 'fallback',
      confidence: 0.5,
    };
  }

  const rateLimiter = options.rateLimiter !== undefined ? options.rateLimiter : defaultGeminiRateLimiter;
  const maxRetries = options.maxRetries ?? 2;
  const sleepFn = options.sleepFn;
  const signal = options.signal;

  const classifier = createGeminiClassifier({
    apiKey: key,
    model: GEMINI_MODEL,
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
 * Hybrid classifier:
 * 1. Checks rule-based classification using Intent & Domain resolution.
 * 2. If ambiguous/sparse, falls back to LLM.
 */
export async function classifyRepo(
  repo: NormalizedRepo,
  geminiApiKeyOrOptions?: string | LLMClassificationOptions
): Promise<ClassificationResult> {
  const ruleResult = classifyWithRules(repo);
  if (ruleResult) {
    return ruleResult;
  }
  return classifyWithLLM(repo, geminiApiKeyOrOptions);
}
