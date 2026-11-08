/**
 * Centralized async rate limiter and retry logic for Gemini API requests.
 * Pure browser-compatible implementation (no Node dependencies).
 */

export interface RateLimiterOptions {
  minIntervalMs?: number; // Minimum interval between requests (default: 4000ms -> 15 req/min free tier)
  sleepFn?: (ms: number) => Promise<void>;
}

export class RateLimiter {
  private minIntervalMs: number;
  private defaultSleepFn: (ms: number) => Promise<void>;
  private lastRequestTime: number = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? 4000;
    this.defaultSleepFn = options.sleepFn ?? (ms => new Promise(r => setTimeout(r, ms)));
  }

  getMinIntervalMs(): number {
    return this.minIntervalMs;
  }

  /**
   * Enqueues an execution and waits until at least minIntervalMs has elapsed
   * since the previous request was dispatched. Respects optional AbortSignal.
   */
  async acquire(
    sleepFnOrSignal?: ((ms: number) => Promise<void>) | AbortSignal,
    signalParam?: AbortSignal
  ): Promise<void> {
    let sleepFn = this.defaultSleepFn;
    let signal: AbortSignal | undefined = signalParam;

    if (sleepFnOrSignal) {
      if (typeof sleepFnOrSignal === 'function') {
        sleepFn = sleepFnOrSignal;
      } else if (typeof sleepFnOrSignal === 'object' && 'aborted' in sleepFnOrSignal) {
        signal = sleepFnOrSignal as AbortSignal;
      }
    }

    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw signal.reason || err;
    }

    const previous = this.queue;
    let release: () => void;
    this.queue = new Promise<void>(resolve => {
      release = resolve;
    });

    await previous;

    if (signal?.aborted) {
      release!();
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw signal.reason || err;
    }

    try {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (this.lastRequestTime > 0 && elapsed < this.minIntervalMs) {
        const waitMs = this.minIntervalMs - elapsed;
        await sleepFn(waitMs);
        if (signal?.aborted) {
          const err = new Error('Operation aborted');
          err.name = 'AbortError';
          throw signal.reason || err;
        }
      }
      this.lastRequestTime = Date.now();
    } finally {
      release!();
    }
  }

  reset(): void {
    this.lastRequestTime = 0;
    this.queue = Promise.resolve();
  }
}

export const defaultGeminiRateLimiter = new RateLimiter({ minIntervalMs: 4000 });

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  rateLimiter?: RateLimiter;
  signal?: AbortSignal;
}

function getErrorDetails(error: unknown): { status?: number; text: string } {
  if (!error) return { text: '' };
  let status: number | undefined;
  let text = '';

  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.status === 'number') status = errObj.status;
    else if (typeof errObj.statusCode === 'number') status = errObj.statusCode;
    else if (typeof errObj.code === 'number') status = errObj.code;

    if (typeof errObj.message === 'string') text += ' ' + errObj.message;
    if (typeof errObj.statusText === 'string') text += ' ' + errObj.statusText;
    if (typeof errObj.details === 'string') text += ' ' + errObj.details;
    if (Array.isArray(errObj.details)) {
      try {
        text += ' ' + JSON.stringify(errObj.details);
      } catch {
        // Ignore JSON error
      }
    }
  }

  if (error instanceof Error) {
    text += ' ' + error.name + ' ' + error.message;
  } else {
    text += ' ' + String(error);
  }

  return { status, text };
}

export function extractRetryDelayMs(error: unknown): number | null {
  if (!error) return null;
  if (typeof error === 'object' && error !== null && 'retryAfterSec' in error) {
    const sec = (error as { retryAfterSec?: unknown }).retryAfterSec;
    if (typeof sec === 'number' && sec > 0) {
      return Math.min(Math.ceil(sec * 1000), 60000);
    }
  }
  const { text } = getErrorDetails(error);
  // Match retryDelay: "42s" or "42.5s"
  const jsonMatch = text.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/i);
  if (jsonMatch && jsonMatch[1]) {
    const s = parseFloat(jsonMatch[1]);
    if (!Number.isNaN(s) && s > 0) {
      return Math.min(Math.ceil(s * 1000) + 1000, 60000);
    }
  }
  // Match "Please retry in 42.69s" or "retry in 42s"
  const textMatch = text.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (textMatch && textMatch[1]) {
    const s = parseFloat(textMatch[1]);
    if (!Number.isNaN(s) && s > 0) {
      return Math.min(Math.ceil(s * 1000) + 1000, 60000);
    }
  }
  return null;
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error && error.name === 'GeminiQuotaError') return true;
  const { status, text } = getErrorDetails(error);
  const upper = text.toUpperCase();
  return (
    upper.includes('INSUFFICIENT_QUOTA') ||
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('QUOTA EXCEEDED') ||
    upper.includes('QUOTA_EXCEEDED') ||
    (status === 429 && upper.includes('QUOTA'))
  );
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'LLMRateLimitError') {
    return true;
  }
  const { status, text } = getErrorDetails(error);
  if (status === 429) return true;
  const upper = text.toUpperCase();
  return (
    upper.includes('429') ||
    upper.includes('RATE LIMIT') ||
    upper.includes('RATELIMIT') ||
    upper.includes('TOO MANY REQUESTS') ||
    upper.includes('RESOURCE_EXHAUSTED')
  );
}

export function isUnavailableError(error: unknown): boolean {
  if (!error) return false;
  const { status, text } = getErrorDetails(error);
  if (status === 503) return true;
  const upper = text.toUpperCase();
  return upper.includes('503') || upper.includes('UNAVAILABLE');
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 60000;
  const sleepFn = options.sleepFn ?? (ms => new Promise(r => setTimeout(r, ms)));
  const rateLimiter = options.rateLimiter;
  const signal = options.signal;

  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw signal.reason || err;
    }

    if (rateLimiter) {
      await rateLimiter.acquire(sleepFn, signal);
    }

    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw signal.reason || err;
    }

    try {
      return await fn();
    } catch (error) {
      if (signal?.aborted) {
        const err = new Error('Operation aborted');
        err.name = 'AbortError';
        throw signal.reason || err;
      }

      // Quota exhaustion should NOT be retried: throw immediately
      if (isQuotaExceededError(error)) {
        throw error;
      }

      const is429 = isRateLimitError(error);
      const is503 = isUnavailableError(error);

      if ((is429 || is503) && attempt < maxRetries) {
        attempt++;
        let delayMs: number;
        if (is429) {
          const serverDelay = extractRetryDelayMs(error);
          delayMs = serverDelay ?? Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        } else {
          delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        }
        await sleepFn(delayMs);
        if (signal?.aborted) {
          const err = new Error('Operation aborted');
          err.name = 'AbortError';
          throw signal.reason || err;
        }
        continue;
      }

      throw error;
    }
  }
}
