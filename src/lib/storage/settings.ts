const TOKEN_STORAGE_KEY = 'starred_repos_github_token';

/**
 * Checks if the token is currently remembered in localStorage.
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

const GEMINI_KEY_STORAGE_KEY = 'starred_repos_gemini_key';
const GEMINI_MODEL_STORAGE_KEY = 'starred_repos_gemini_model';
const GEMINI_INTERVAL_STORAGE_KEY = 'starred_repos_gemini_interval';

/**
 * Checks if the Gemini API key is currently remembered in localStorage.
 */
export function isGeminiKeyRemembered(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      return Boolean(localStorage.getItem(GEMINI_KEY_STORAGE_KEY));
    }
  } catch {
    // Storage might be restricted
  }
  return false;
}

/**
 * Loads the Gemini API key from storage (sessionStorage first, then localStorage).
 */
export function loadGeminiKey(): string | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const sessionKey = sessionStorage.getItem(GEMINI_KEY_STORAGE_KEY);
      if (sessionKey) return sessionKey;
    }
  } catch {
    // Ignore storage access error
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const localKey = localStorage.getItem(GEMINI_KEY_STORAGE_KEY);
      if (localKey) return localKey;
    }
  } catch {
    // Ignore storage access error
  }

  return null;
}

/**
 * Saves the Gemini API key to sessionStorage (default) or localStorage (if remember is true).
 * Ensures old keys are removed from the alternate storage location.
 * Never logs the key.
 */
export function saveGeminiKey(key: string, remember: boolean): void {
  const trimmed = key.trim();
  if (!trimmed) {
    clearGeminiKey();
    return;
  }

  if (remember) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(GEMINI_KEY_STORAGE_KEY, trimmed);
      }
    } catch {
      // Storage write error
    }
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
      }
    } catch {
      // Storage removal error
    }
  } else {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(GEMINI_KEY_STORAGE_KEY, trimmed);
      }
    } catch {
      // Storage write error
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
      }
    } catch {
      // Storage removal error
    }
  }
}

/**
 * Clears the stored Gemini API key from both sessionStorage and localStorage.
 */
export function clearGeminiKey(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
    }
  } catch {
    // Storage removal error
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
    }
  } catch {
    // Storage removal error
  }
}

export function loadGeminiSettings(): { model: string; intervalSec: number } {
  let model = 'gemini-3.8-flash';
  let intervalSec = 4.0;

  try {
    if (typeof localStorage !== 'undefined') {
      const savedModel = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY);
      if (savedModel && savedModel.trim()) {
        model = savedModel.trim();
      }

      const savedInterval = localStorage.getItem(GEMINI_INTERVAL_STORAGE_KEY);
      if (savedInterval) {
        const parsed = parseFloat(savedInterval);
        if (!Number.isNaN(parsed) && parsed >= 1) {
          intervalSec = parsed;
        }
      }
    }
  } catch {
    // Ignore storage access error
  }

  return { model, intervalSec };
}

export function saveGeminiSettings(
  modelOrSettings: string | { model: string; intervalSec: number },
  intervalSecParam?: number
): void {
  let model = 'gemini-3.8-flash';
  let intervalSec = 4.0;

  if (typeof modelOrSettings === 'object' && modelOrSettings !== null) {
    model = modelOrSettings.model;
    intervalSec = modelOrSettings.intervalSec;
  } else {
    model = modelOrSettings;
    intervalSec = intervalSecParam ?? 4.0;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, model.trim());
      localStorage.setItem(GEMINI_INTERVAL_STORAGE_KEY, String(intervalSec));
    }
  } catch {
    // Ignore storage write error
  }
}
