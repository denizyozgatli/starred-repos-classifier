import { GoogleGenAI } from '@google/genai';
import { ALLOWED_CATEGORIES, type RepositoryCategory } from '../../src/types/repo.ts';
import type { NormalizedRepo } from './normalize.ts';
import { RateLimiter, defaultGeminiRateLimiter, executeWithRetry } from './rate-limiter.ts';
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

export {
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
};

export const GEMINI_MODEL = 'gemini-3.8-flash';

export interface LLMClassificationOptions {
  apiKey?: string;
  rateLimiter?: RateLimiter;
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Classifies an ambiguous repository using the Gemini LLM.
 * Falls back to "Other" with method: 'fallback' if no API key is provided or if an error occurs.
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

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const prompt = `You are an expert software classifier. Categorize this GitHub repository into EXACTLY ONE of the following allowed categories:
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

    const parsed = await executeWithRetry(
      async () => {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const text = response.text || '';
        return JSON.parse(text);
      },
      {
        rateLimiter,
        maxRetries,
        sleepFn,
      }
    );

    if (parsed && parsed.category && ALLOWED_CATEGORIES.includes(parsed.category as RepositoryCategory)) {
      return {
        category: parsed.category as RepositoryCategory,
        method: 'llm',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
      };
    }
  } catch (error) {
    console.warn(`[classifier] LLM classification failed for ${repo.fullName}:`, error);
  }

  return {
    category: 'Other',
    method: 'fallback',
    confidence: 0.5,
  };
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
