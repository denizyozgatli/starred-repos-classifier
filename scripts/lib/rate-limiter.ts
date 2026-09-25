/**
 * Centralized async rate limiter and retry logic for Gemini API requests.
 */

export interface RateLimiterOptions {
  minIntervalMs?: number; // Minimum interval between requests (default: 12500ms -> <= 4.8 req/min)
}

export class RateLimiter {
  private minIntervalMs: number;
  private lastRequestTime: number = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? 12500;
  }

  getMinIntervalMs(): number {
    return this.minIntervalMs;
  }

  /**
   * Enqueues an execution and waits until at least minIntervalMs has elapsed
   * since the previous request was dispatched.
   */
  async acquire(sleepFn: (ms: number) => Promise<void> = (ms) => new Promise(r => setTimeout(r, ms))): Promise<void> {
    const previous = this.queue;
    let release: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (this.lastRequestTime > 0 && elapsed < this.minIntervalMs) {
        const waitMs = this.minIntervalMs - elapsed;
        await sleepFn(waitMs);
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

export const defaultGeminiRateLimiter = new RateLimiter({ minIntervalMs: 12500 });

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  rateLimiter?: RateLimiter;
}

export function extractRetryDelayMs(error: unknown): number | null {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  // Match retryDelay: "42s" or "42.5s"
  const jsonMatch = msg.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/i);
  if (jsonMatch && jsonMatch[1]) {
    const s = parseFloat(jsonMatch[1]);
    if (!isNaN(s) && s > 0) {
      return Math.min(Math.ceil(s * 1000) + 1000, 60000);
    }
  }
  // Match "Please retry in 42.69s" or "retry in 42s"
  const textMatch = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (textMatch && textMatch[1]) {
    const s = parseFloat(textMatch[1]);
    if (!isNaN(s) && s > 0) {
      return Math.min(Math.ceil(s * 1000) + 1000, 60000);
    }
  }
  return null;
}

export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;
  const str = String(error) + ' ' + (error instanceof Error ? error.message : '');
  return str.includes('429') || str.includes('RESOURCE_EXHAUSTED');
}

export function isUnavailableError(error: unknown): boolean {
  if (!error) return false;
  const str = String(error) + ' ' + (error instanceof Error ? error.message : '');
  return str.includes('503') || str.includes('UNAVAILABLE');
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 60000;
  const sleepFn = options.sleepFn ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const rateLimiter = options.rateLimiter;

  let attempt = 0;
  while (true) {
    if (rateLimiter) {
      await rateLimiter.acquire(sleepFn);
    }

    try {
      return await fn();
    } catch (error) {
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
        continue;
      }

      throw error;
    }
  }
}
