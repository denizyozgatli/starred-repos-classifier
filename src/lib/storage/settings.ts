import type { LLMProviderId } from '../../core/llm-providers.ts';
import { LLM_PROVIDERS } from '../../core/llm-providers.ts';
import { PROVIDER_DEFAULTS } from '../../core/llm.ts';

const TOKEN_STORAGE_KEY = 'starred_repos_github_token';

/**
 * Checks if the GitHub token is currently remembered in localStorage.
 */
export function isTokenRemembered(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      return Boolean(localStorage.getItem(TOKEN_STORAGE_KEY));
    }
  } catch {
    // Storage might be restricted (e.g. private browsing mode)
  }
  return false;
}

/**
 * Loads the GitHub personal access token from storage.
 * Checks sessionStorage first (current session), then localStorage (remembered device).
 */
export function loadToken(): string | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const sessionToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (sessionToken) return sessionToken;
    }
  } catch {
    // Ignore storage access error
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const localToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (localToken) return localToken;
    }
  } catch {
    // Ignore storage access error
  }

  return null;
}

/**
 * Saves the GitHub token to sessionStorage (default) or localStorage (if remember is true).
 * Ensures the token is cleared from the alternate storage location.
 * Never logs the token.
 */
export function saveToken(token: string, remember: boolean): void {
  const trimmed = token.trim();
  if (!trimmed) {
    clearToken();
    return;
  }

  if (remember) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TOKEN_STORAGE_KEY, trimmed);
      }
    } catch {
      // Storage write error
    }
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch {
      // Storage removal error
    }
  } else {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, trimmed);
      }
    } catch {
      // Storage write error
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch {
      // Storage removal error
    }
  }
}

/**
 * Clears the stored token from both sessionStorage and localStorage.
 */
export function clearToken(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage removal error
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage removal error
  }
}

// ---------------------------------------------------------------------------
// Provider-Aware LLM Settings
// ---------------------------------------------------------------------------

export const LLM_SETTINGS_STORAGE_KEY = 'starred_repos_llm_settings';

const OLD_GEMINI_KEY = 'starred_repos_gemini_key';
const OLD_GEMINI_MODEL = 'starred_repos_gemini_model';
const OLD_GEMINI_INTERVAL = 'starred_repos_gemini_interval';

export interface ProviderSettingsEntry {
  apiKey: string;
  model: string;
  intervalSec: number | null; // null = AUTO (use provider default at call time)
  remember?: boolean;
}

export interface LlmSettings {
  provider: LLMProviderId;
  providers: Record<LLMProviderId, ProviderSettingsEntry>;
}

export function createDefaultLlmSettings(): LlmSettings {
  return {
    provider: 'google',
    providers: {
      openai: {
        apiKey: '',
        model: PROVIDER_DEFAULTS.openai.defaultModel,
        intervalSec: null,
        remember: false,
      },
      anthropic: {
        apiKey: '',
        model: PROVIDER_DEFAULTS.anthropic.defaultModel,
        intervalSec: null,
        remember: false,
      },
      google: {
        apiKey: '',
        model: PROVIDER_DEFAULTS.google.defaultModel,
        intervalSec: null,
        remember: false,
      },
      deepseek: {
        apiKey: '',
        model: PROVIDER_DEFAULTS.deepseek.defaultModel,
        intervalSec: null,
        remember: false,
      },
    },
  };
}

/**
 * Detects LLM provider based on API key prefix/pattern.
 * For 'sk-' keys matching both OpenAI and DeepSeek, returns null and lets UI ask.
 */
export function detectProvider(apiKey: string): LLMProviderId | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;

  const matching = Object.values(LLM_PROVIDERS).filter(p => p.keyPattern.test(trimmed));
  if (matching.length === 1) {
    return matching[0].id;
  }
  return null;
}

/**
 * Migrates old single-Gemini keys to the new multi-provider structure if found.
 * Never logs migrated values.
 */
function migrateLegacySettings(): LlmSettings | null {
  let oldKey: string | null = null;
  let oldModel: string | null = null;
  let oldInterval: string | null = null;
  let remembered = false;

  try {
    if (typeof localStorage !== 'undefined') {
      const k = localStorage.getItem(OLD_GEMINI_KEY);
      if (k) {
        oldKey = k;
        remembered = true;
      }
      oldModel = localStorage.getItem(OLD_GEMINI_MODEL);
      oldInterval = localStorage.getItem(OLD_GEMINI_INTERVAL);
    }
  } catch {
    // Ignore storage errors
  }

  try {
    if (typeof sessionStorage !== 'undefined') {
      const k = sessionStorage.getItem(OLD_GEMINI_KEY);
      if (k && !oldKey) {
        oldKey = k;
        remembered = false;
      }
      if (!oldModel) oldModel = sessionStorage.getItem(OLD_GEMINI_MODEL);
      if (!oldInterval) oldInterval = sessionStorage.getItem(OLD_GEMINI_INTERVAL);
    }
  } catch {
    // Ignore storage errors
  }

  // Only migrate if at least one legacy key was present
  if (oldKey === null && oldModel === null && oldInterval === null) {
    return null;
  }

  const defaults = createDefaultLlmSettings();
  let intervalSec: number | null = null;
  if (oldInterval) {
    const parsed = parseFloat(oldInterval);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      intervalSec = parsed;
    }
  }

  defaults.provider = 'google';
  defaults.providers.google = {
    apiKey: oldKey?.trim() || '',
    model: oldModel?.trim() || PROVIDER_DEFAULTS.google.defaultModel,
    intervalSec,
    remember: remembered,
  };

  // Remove old keys from both storages
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(OLD_GEMINI_KEY);
      localStorage.removeItem(OLD_GEMINI_MODEL);
      localStorage.removeItem(OLD_GEMINI_INTERVAL);
    }
  } catch {}
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(OLD_GEMINI_KEY);
      sessionStorage.removeItem(OLD_GEMINI_MODEL);
      sessionStorage.removeItem(OLD_GEMINI_INTERVAL);
    }
  } catch {}

  saveLlmSettings(defaults);
  return defaults;
}

/**
 * Loads provider-aware LLM settings from storage.
 * Reads localStorage (remembered device state) and merges sessionStorage (session overrides).
 */
export function loadLlmSettings(): LlmSettings {
  const migrated = migrateLegacySettings();
  if (migrated) return migrated;

  const result = createDefaultLlmSettings();
  const providerIds: LLMProviderId[] = ['openai', 'anthropic', 'google', 'deepseek'];

  let localData: Partial<LlmSettings> | null = null;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LLM_SETTINGS_STORAGE_KEY);
      if (raw) localData = JSON.parse(raw);
    }
  } catch {}

  let sessionData: Partial<LlmSettings> | null = null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(LLM_SETTINGS_STORAGE_KEY);
      if (raw) sessionData = JSON.parse(raw);
    }
  } catch {}

  if (localData?.provider && providerIds.includes(localData.provider)) {
    result.provider = localData.provider;
  }
  if (sessionData?.provider && providerIds.includes(sessionData.provider)) {
    result.provider = sessionData.provider;
  }

  for (const id of providerIds) {
    const locP = localData?.providers?.[id];
    const sessP = sessionData?.providers?.[id];

    const model = sessP?.model || locP?.model || PROVIDER_DEFAULTS[id].defaultModel;
    const rawInterval = sessP?.intervalSec !== undefined ? sessP.intervalSec : locP?.intervalSec;
    const intervalSec = typeof rawInterval === 'number' && rawInterval >= 1 ? rawInterval : null;
    const remember = Boolean(locP?.remember ?? sessP?.remember);

    let apiKey = '';
    if (remember && locP?.apiKey) {
      apiKey = locP.apiKey;
    } else if (sessP?.apiKey) {
      apiKey = sessP.apiKey;
    } else if (locP?.apiKey) {
      apiKey = locP.apiKey;
    }

    result.providers[id] = {
      apiKey: apiKey.trim(),
      model,
      intervalSec,
      remember,
    };
  }

  return result;
}

/**
 * Saves provider-aware LLM settings.
 * Persists apiKey in localStorage if remember=true for that provider, else sessionStorage.
 * If optional auth argument is passed, updates active provider's credentials first.
 */
export function saveLlmSettings(
  settings: LlmSettings,
  auth?: { apiKey?: string; remember?: boolean }
): void {
  const providerIds: LLMProviderId[] = ['openai', 'anthropic', 'google', 'deepseek'];

  if (auth) {
    const activeProvider = settings.provider;
    if (settings.providers[activeProvider]) {
      if (auth.apiKey !== undefined) {
        settings.providers[activeProvider].apiKey = auth.apiKey.trim();
      }
      if (auth.remember !== undefined) {
        settings.providers[activeProvider].remember = auth.remember;
      }
    }
  }

  const localPayload: LlmSettings = {
    provider: settings.provider,
    providers: { ...createDefaultLlmSettings().providers },
  };
  const sessionPayload: LlmSettings = {
    provider: settings.provider,
    providers: { ...createDefaultLlmSettings().providers },
  };

  for (const id of providerIds) {
    const entry = settings.providers[id] || {
      apiKey: '',
      model: PROVIDER_DEFAULTS[id].defaultModel,
      intervalSec: null,
      remember: false,
    };
    const isRemembered = Boolean(entry.remember);

    localPayload.providers[id] = {
      apiKey: isRemembered ? entry.apiKey.trim() : '',
      model: entry.model || PROVIDER_DEFAULTS[id].defaultModel,
      intervalSec: entry.intervalSec,
      remember: isRemembered,
    };

    sessionPayload.providers[id] = {
      apiKey: isRemembered ? '' : entry.apiKey.trim(),
      model: entry.model || PROVIDER_DEFAULTS[id].defaultModel,
      intervalSec: entry.intervalSec,
      remember: isRemembered,
    };
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LLM_SETTINGS_STORAGE_KEY, JSON.stringify(localPayload));
    }
  } catch {}

  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(LLM_SETTINGS_STORAGE_KEY, JSON.stringify(sessionPayload));
    }
  } catch {}
}

/**
 * Clears the stored LLM API key for a specific provider from both storage locations.
 */
export function clearLlmKey(providerId: LLMProviderId): void {
  const current = loadLlmSettings();
  if (current.providers[providerId]) {
    current.providers[providerId].apiKey = '';
    current.providers[providerId].remember = false;
  }
  saveLlmSettings(current);

  if (providerId === 'google') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(OLD_GEMINI_KEY);
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(OLD_GEMINI_KEY);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Deprecated Legacy Wrappers (kept for backward compatibility)
// ---------------------------------------------------------------------------

/** @deprecated Use loadLlmSettings instead */
export function isGeminiKeyRemembered(): boolean {
  const settings = loadLlmSettings();
  return Boolean(settings.providers.google?.remember);
}

/** @deprecated Use loadLlmSettings instead */
export function loadGeminiKey(): string | null {
  const settings = loadLlmSettings();
  return settings.providers.google?.apiKey || null;
}

/** @deprecated Use saveLlmSettings instead */
export function saveGeminiKey(key: string, remember: boolean): void {
  const settings = loadLlmSettings();
  settings.providers.google = {
    ...settings.providers.google,
    apiKey: key,
    remember,
  };
  saveLlmSettings(settings);
}

/** @deprecated Use clearLlmKey instead */
export function clearGeminiKey(): void {
  clearLlmKey('google');
}

/** @deprecated Use loadLlmSettings instead */
export function loadGeminiSettings(): { model: string; intervalSec: number } {
  const settings = loadLlmSettings();
  return {
    model: settings.providers.google?.model || PROVIDER_DEFAULTS.google.defaultModel,
    intervalSec: settings.providers.google?.intervalSec ?? PROVIDER_DEFAULTS.google.defaultIntervalSec,
  };
}

/** @deprecated Use saveLlmSettings instead */
export function saveGeminiSettings(
  modelOrSettings: string | { model: string; intervalSec: number },
  intervalSecParam?: number
): void {
  const settings = loadLlmSettings();
  let model = settings.providers.google?.model || PROVIDER_DEFAULTS.google.defaultModel;
  let intervalSec: number | null = settings.providers.google?.intervalSec ?? null;
  if (typeof modelOrSettings === 'object' && modelOrSettings !== null) {
    model = modelOrSettings.model;
    intervalSec = modelOrSettings.intervalSec;
  } else {
    model = modelOrSettings;
    intervalSec = intervalSecParam ?? null;
  }
  settings.providers.google = {
    ...settings.providers.google,
    model,
    intervalSec,
  };
  saveLlmSettings(settings);
}
