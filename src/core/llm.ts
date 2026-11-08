import { ALLOWED_CATEGORIES, type RepositoryCategory } from '../types/repo.ts';
import type { NormalizedRepo } from './normalize.ts';
import type { ClassificationResult } from './classifier.ts';
import {
  RateLimiter,
  executeWithRetry,
  isRateLimitError,
  isQuotaExceededError,
} from './rate-limiter.ts';

export const GEMINI_MODEL = 'gemini-3.8-flash';

export class GeminiQuotaError extends Error {
  constructor(message: string = 'Gemini API quota exceeded (RESOURCE_EXHAUSTED / 429).') {
    super(message);
    this.name = 'GeminiQuotaError';
  }
}

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

export interface GeminiClassifierOptions {
  apiKey: string;
  model?: string;
  minIntervalMs?: number;
  signal?: AbortSignal;
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
  rateLimiter?: RateLimiter;
}

export function createGeminiClassifier(
  options: GeminiClassifierOptions
): (repo: NormalizedRepo) => Promise<ClassificationResult> {
  const {
    apiKey,
    model = GEMINI_MODEL,
    minIntervalMs = 4000,
    signal,
    sleepFn,
    maxRetries = 2,
  } = options;

  const rateLimiter = options.rateLimiter ?? new RateLimiter({ minIntervalMs });

  return async (repo: NormalizedRepo): Promise<ClassificationResult> => {
    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw signal.reason || err;
    }

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildClassificationPrompt(repo);

    try {
      const responseText = await executeWithRetry(
        async () => {
          if (signal?.aborted) {
            const err = new Error('Operation aborted');
            err.name = 'AbortError';
            throw signal.reason || err;
          }

          const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
            },
          });

          return response.text || '';
        },
        {
          rateLimiter,
          maxRetries,
          sleepFn,
          signal,
        }
      );

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
    } catch (err) {
      if (signal?.aborted) {
        const abortErr = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        throw signal.reason || abortErr;
      }

      if (err instanceof GeminiQuotaError) {
        throw err;
      }

      if (isQuotaExceededError(err) || isRateLimitError(err)) {
        const msg = err instanceof Error ? err.message : (err && typeof err === 'object' && 'message' in err) ? String((err as Record<string, unknown>).message) : String(err);
        throw new GeminiQuotaError(msg);
      }

      throw err;
    }
  };
}
