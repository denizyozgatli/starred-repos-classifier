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
