export type LLMProviderId = 'openai' | 'anthropic' | 'google' | 'deepseek';

export class LLMProviderError extends Error {
  readonly provider: LLMProviderId;
  readonly status?: number;

  constructor(
    provider: LLMProviderId,
    message: string,
    options?: { status?: number; cause?: unknown }
  ) {
    super(message);
    this.name = 'LLMProviderError';
    this.provider = provider;
    this.status = options?.status;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export class LLMRateLimitError extends LLMProviderError {
  readonly retryAfterSec?: number;

  constructor(
    provider: LLMProviderId,
    message: string = `Rate limit or quota exceeded for ${provider}.`,
    options?: { retryAfterSec?: number; status?: number; cause?: unknown }
  ) {
    super(provider, message, options);
    this.name = 'LLMRateLimitError';
    this.retryAfterSec = options?.retryAfterSec;
  }
}

export class LLMAuthError extends LLMProviderError {
  constructor(
    provider: LLMProviderId,
    message: string = `Authentication failed for provider ${provider}. Check your API key.`,
    options?: { status?: number; cause?: unknown }
  ) {
    super(provider, message, options);
    this.name = 'LLMAuthError';
  }
}

export class LLMError extends LLMProviderError {
  readonly code?: string;

  constructor(
    provider: LLMProviderId,
    message: string,
    options?: { status?: number; code?: string; cause?: unknown }
  ) {
    super(provider, message, options);
    this.name = 'LLMError';
    this.code = options?.code;
  }
}

export function isModelNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  if (status === 404) return true;

  const code = (err as { code?: string }).code;
  const message = (err as { message?: string }).message || '';

  if (
    code === 'model_not_found' ||
    code === 'not_found_error' ||
    code === 'NOT_FOUND'
  ) {
    return true;
  }
  const lower = message.toLowerCase();
  if (
    lower.includes('model_not_found') ||
    lower.includes('not_found_error') ||
    lower.includes('not_found') ||
    lower.includes('not found') ||
    lower.includes('does not exist') ||
    lower.includes('unrecognized model') ||
    lower.includes('invalid model')
  ) {
    return true;
  }
  return false;
}

export interface LLMProviderDef {
  id: LLMProviderId;
  label: string;
  keyPattern: RegExp;
  keyPlaceholder: string;
  defaultModel: string;
  defaultIntervalSec: number;
  pickPreferredModel(models: string[]): string | null;
  listModels(args: { apiKey: string; signal?: AbortSignal }): Promise<string[]>;
  classify(args: { apiKey: string; model: string; prompt: string; signal?: AbortSignal }): Promise<string>;
}

function sanitizeApiKey(text: string, apiKey: string): string {
  if (!apiKey || !apiKey.trim()) return text;
  return text.replaceAll(apiKey.trim(), '[REDACTED]');
}

async function safeFetch(
  url: string,
  init: RequestInit | undefined,
  provider: LLMProviderId,
  apiKey: string
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (init?.signal?.aborted) {
      const abortErr = new Error('Operation aborted');
      abortErr.name = 'AbortError';
      throw init.signal.reason || abortErr;
    }
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = sanitizeApiKey(rawMsg, apiKey);
    throw new LLMError(provider, `Network error communicating with ${provider}: ${safeMsg}`, { cause: err });
  }
}

async function parseErrorBody(
  response: Response,
  apiKey: string
): Promise<{ text: string; json: Record<string, unknown> | null }> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    text = '';
  }
  text = sanitizeApiKey(text, apiKey);

  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { text, json };
}

function extractRetryAfter(response: Response, bodyText: string): number | undefined {
  const headerVal = response.headers.get('retry-after');
  if (headerVal) {
    const sec = parseInt(headerVal, 10);
    if (!Number.isNaN(sec) && sec > 0) return sec;
  }
  const match = bodyText.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/i) || bodyText.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (match && match[1]) {
    const parsed = parseFloat(match[1]);
    if (!Number.isNaN(parsed) && parsed > 0) return Math.ceil(parsed);
  }
  return undefined;
}

function handleUniformError(
  provider: LLMProviderId,
  status: number,
  bodyText: string,
  json: Record<string, unknown> | null,
  retryAfterSec?: number
): never {
  let errMsg = '';
  let errCode: string | undefined;
  if (json && typeof json.error === 'object' && json.error !== null) {
    const errObj = json.error as Record<string, unknown>;
    errMsg = typeof errObj.message === 'string' ? errObj.message : '';
    errCode =
      typeof errObj.code === 'string'
        ? errObj.code
        : typeof errObj.type === 'string'
        ? errObj.type
        : typeof errObj.status === 'string'
        ? errObj.status
        : undefined;
  } else if (json && typeof json.message === 'string') {
    errMsg = json.message;
  }
  if (!errMsg) {
    errMsg = bodyText || `HTTP ${status}`;
  }

  // Format single line, max ~140 chars, with status + message
  let sanitizedMsg = errMsg.replace(/\s+/g, ' ').trim();
  let formattedMsg = sanitizedMsg.includes(String(status))
    ? sanitizedMsg
    : `${status} ${sanitizedMsg}`;
  if (formattedMsg.length > 140) {
    formattedMsg = formattedMsg.slice(0, 137) + '...';
  }

  // Check rate limit / quota exhaustion
  const isGoogleExhausted =
    provider === 'google' &&
    (status === 400 || status === 403) &&
    (bodyText.includes('RESOURCE_EXHAUSTED') || (json?.error as Record<string, unknown> | undefined)?.status === 'RESOURCE_EXHAUSTED');

  const isOpenAIQuota =
    (provider === 'openai' || provider === 'deepseek') &&
    json &&
    typeof json.error === 'object' &&
    ((json.error as Record<string, unknown>)?.type === 'insufficient_quota' ||
      (json.error as Record<string, unknown>)?.code === 'insufficient_quota');

  if (status === 429 || isGoogleExhausted || isOpenAIQuota) {
    throw new LLMRateLimitError(provider, formattedMsg, { retryAfterSec, status });
  }

  // Auth errors (401 or non-rate-limit 403)
  if (status === 401 || status === 403) {
    throw new LLMAuthError(provider, formattedMsg, { status });
  }

  // Other HTTP errors
  throw new LLMError(provider, formattedMsg, { status, code: errCode });
}

export const openaiProvider: LLMProviderDef = {
  id: 'openai',
  label: 'OpenAI',
  keyPattern: /^sk-(?!ant-)/,
  keyPlaceholder: 'sk-...',
  defaultModel: 'gpt-6-luna',
  defaultIntervalSec: 1,
  pickPreferredModel(models: string[]): string | null {
    const gpt6 = models.find(m => /^gpt-6/i.test(m));
    if (gpt6) return gpt6;
    const mini = models.find(m => /mini/i.test(m));
    if (mini) return mini;
    return null;
  },
  async listModels({ apiKey, signal }) {
    const res = await safeFetch(
      'https://api.openai.com/v1/models',
      {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        signal,
      },
      'openai',
      apiKey
    );

    if (!res.ok) {
      const { text, json } = await parseErrorBody(res, apiKey);
      handleUniformError('openai', res.status, text, json, extractRetryAfter(res, text));
    }

    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (data.data || [])
      .map(m => m.id || '')
      .filter(id => /^(gpt-|o[134]-|chatgpt-)/.test(id))
      .sort((a, b) => b.localeCompare(a));
    return ids;
  },
  async classify({ apiKey, model, prompt, signal }) {
    const makeRequest = async (withJsonFormat: boolean) => {
      const payload: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      };
      if (model.startsWith('gpt-6')) {
        payload.reasoning_effort = 'none';
      }
      if (withJsonFormat) {
        payload.response_format = { type: 'json_object' };
      }
      return safeFetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal,
        },
        'openai',
        apiKey
      );
    };

    let res = await makeRequest(true);
    if (!res.ok) {
      const { text, json } = await parseErrorBody(res, apiKey);
      if (res.status === 400 && text.toLowerCase().includes('response_format')) {
        res = await makeRequest(false);
        if (!res.ok) {
          const retryBody = await parseErrorBody(res, apiKey);
          handleUniformError('openai', res.status, retryBody.text, retryBody.json, extractRetryAfter(res, retryBody.text));
        }
      } else {
        handleUniformError('openai', res.status, text, json, extractRetryAfter(res, text));
      }
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || '';
  },
};

export const deepseekProvider: LLMProviderDef = {
  id: 'deepseek',
  label: 'DeepSeek',
  keyPattern: /^sk-(?!ant-)/,
  keyPlaceholder: 'sk-...',
  defaultModel: 'deepseek-chat',
  defaultIntervalSec: 1,
  pickPreferredModel(models: string[]): string | null {
    const chat = models.find(m => m === 'deepseek-chat');
    return chat || null;
  },
  async listModels({ apiKey, signal }) {
    const res = await safeFetch(
      'https://api.deepseek.com/models',
      {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        signal,
      },
      'deepseek',
      apiKey
    );

    if (!res.ok) {
      const { text, json } = await parseErrorBody(res, apiKey);
      handleUniformError('deepseek', res.status, text, json, extractRetryAfter(res, text));
    }

    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data || []).map(m => m.id || '').filter(Boolean);
  },
  async classify({ apiKey, model, prompt, signal }) {
    const res = await safeFetch(
      'https://api.deepseek.com/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
        }),
        signal,
      },
      'deepseek',
      apiKey
    );

    if (!res.ok) {
      const { text, json } = await parseErrorBody(res, apiKey);
      handleUniformError('deepseek', res.status, text, json, extractRetryAfter(res, text));
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || '';
  },
};

export const anthropicProvider: LLMProviderDef = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  keyPattern: /^sk-ant-/,
  keyPlaceholder: 'sk-ant-...',
  defaultModel: 'claude-sonnet-5-5',
  defaultIntervalSec: 1,
  pickPreferredModel(models: string[]): string | null {
    const sonnet = models.find(m => m.toLowerCase().includes('sonnet'));
    return sonnet || null;
  },
  async listModels({ apiKey, signal }) {
    const res = await safeFetch(
      'https://api.anthropic.com/v1/models',
      {
        headers: {
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        signal,
      },
      'anthropic',
      apiKey
    );

    if (!res.ok) {
      const { text, json } = await parseErrorBody(res, apiKey);
      handleUniformError('anthropic', res.status, text, json, extractRetryAfter(res, text));
    }

    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data || []).map(m => m.id || '').filter(Boolean);
  },
  async classify({ apiKey, model, prompt, signal }) {
    const res = await safeFetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal,
      },
      'anthropic',
      apiKey
    );

    if (!res.ok) {
      const { text, json } = await parseErrorBody(res, apiKey);
      handleUniformError('anthropic', res.status, text, json, extractRetryAfter(res, text));
    }

    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    if (Array.isArray(data.content)) {
      return data.content.map(b => b.text || '').join('');
    }
    return '';
  },
};

export const googleProvider: LLMProviderDef = {
  id: 'google',
  label: 'Google Gemini',
  keyPattern: /^(?:AIza|AQ\.)/,
  keyPlaceholder: 'AQ....',
  defaultModel: 'gemini-3.8-flash',
  defaultIntervalSec: 4,
  pickPreferredModel(models: string[]): string | null {
    const flash = models.find(m => m.toLowerCase().includes('flash'));
    return flash || null;
  },
  async listModels({ apiKey, signal }) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models';
    const res = await safeFetch(
      url,
      {
        headers: {
          'x-goog-api-key': apiKey.trim(),
        },
        signal,
      },
      'google',
      apiKey
    );

    if (!res.ok) {
      const { text, json } = await parseErrorBody(res, apiKey);
      handleUniformError('google', res.status, text, json, extractRetryAfter(res, text));
    }

    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    return (data.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => (m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
  },
  async classify({ apiKey, model, prompt, signal }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await safeFetch(
      url,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
        signal,
      },
      'google',
      apiKey
    );

    if (!res.ok) {
      const { text, json } = await parseErrorBody(res, apiKey);
      handleUniformError('google', res.status, text, json, extractRetryAfter(res, text));
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map(p => p.text || '').join('');
  },
};

export const LLM_PROVIDERS: Record<LLMProviderId, LLMProviderDef> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  deepseek: deepseekProvider,
};

export function getLLMProvider(id: LLMProviderId): LLMProviderDef {
  const provider = LLM_PROVIDERS[id];
  if (!provider) {
    throw new Error(`Unsupported LLM provider: "${id}"`);
  }
  return provider;
}
