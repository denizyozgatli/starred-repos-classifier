import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  syncStarredRepos,
  shouldAutoRefresh,
  resetAIClassifications,
  SyncError,
  DEFAULT_MAX_CACHE_AGE_MS,
  resolveSyncFailure,
  type SyncProgress,
} from '../src/lib/sync.ts';
import { createActivityLog } from '../src/lib/activityLog.ts';
import {
  MemoryStore,
  getSyncLog,
  appendSyncLog,
  clearSyncLog,
} from '../src/lib/storage/datasetStore.ts';
import { saveToken, loadToken, clearToken, isTokenRemembered } from '../src/lib/storage/settings.ts';
import { classifyRepos } from '../src/core/classify-repos.ts';
import type { DatasetEnvelope } from '../src/types/repo.ts';

class MockStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

describe('Sync Engine & Storage', () => {
  const originalFetch = globalThis.fetch;
  let mockSessionStorage: MockStorage;
  let mockLocalStorage: MockStorage;

  beforeEach(() => {
    mockSessionStorage = new MockStorage();
    mockLocalStorage = new MockStorage();
    vi.stubGlobal('sessionStorage', mockSessionStorage);
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  describe('settings.ts token storage', () => {
    it('uses sessionStorage when remember=false', () => {
      saveToken('ghp_test_session', false);
      expect(mockSessionStorage.getItem('starred_repos_github_token')).toBe('ghp_test_session');
      expect(mockLocalStorage.getItem('starred_repos_github_token')).toBeNull();
      expect(loadToken()).toBe('ghp_test_session');
      expect(isTokenRemembered()).toBe(false);
    });

    it('uses localStorage when remember=true', () => {
      saveToken('ghp_test_local', true);
      expect(mockLocalStorage.getItem('starred_repos_github_token')).toBe('ghp_test_local');
      expect(mockSessionStorage.getItem('starred_repos_github_token')).toBeNull();
      expect(loadToken()).toBe('ghp_test_local');
      expect(isTokenRemembered()).toBe(true);
    });

    it('clears token from both storages', () => {
      mockSessionStorage.setItem('starred_repos_github_token', 'old_session');
      mockLocalStorage.setItem('starred_repos_github_token', 'old_local');

      clearToken();

      expect(mockSessionStorage.getItem('starred_repos_github_token')).toBeNull();
      expect(mockLocalStorage.getItem('starred_repos_github_token')).toBeNull();
      expect(loadToken()).toBeNull();
    });

    it('switching remember from true to false removes from localStorage and sets in sessionStorage', () => {
      saveToken('ghp_token_123', true);
      expect(mockLocalStorage.getItem('starred_repos_github_token')).toBe('ghp_token_123');

      saveToken('ghp_token_123', false);
      expect(mockLocalStorage.getItem('starred_repos_github_token')).toBeNull();
      expect(mockSessionStorage.getItem('starred_repos_github_token')).toBe('ghp_token_123');
    });
  });

  describe('shouldAutoRefresh boundaries', () => {
    const maxAge = DEFAULT_MAX_CACHE_AGE_MS; // 6 hours

    it('returns true if lastSyncAt is null or undefined or empty', () => {
      expect(shouldAutoRefresh(null)).toBe(true);
      expect(shouldAutoRefresh(undefined)).toBe(true);
      expect(shouldAutoRefresh('')).toBe(true);
      expect(shouldAutoRefresh('invalid-date')).toBe(true);
    });

    it('returns false when last sync is strictly less than maxAgeMs ago', () => {
      const now = 1000000000;
      const lastSyncAt = new Date(now - (maxAge - 1000)).toISOString();
      expect(shouldAutoRefresh(lastSyncAt, now, maxAge)).toBe(false);
    });

    it('returns true when last sync is exactly maxAgeMs ago', () => {
      const now = 1000000000;
      const lastSyncAt = new Date(now - maxAge).toISOString();
      expect(shouldAutoRefresh(lastSyncAt, now, maxAge)).toBe(true);
    });

    it('returns true when last sync is older than maxAgeMs ago', () => {
      const now = 1000000000;
      const lastSyncAt = new Date(now - (maxAge + 60000)).toISOString();
      expect(shouldAutoRefresh(lastSyncAt, now, maxAge)).toBe(true);
    });

    it('returns false if clock skewed into the future', () => {
      const now = 1000000000;
      const lastSyncAt = new Date(now + 60000).toISOString();
      expect(shouldAutoRefresh(lastSyncAt, now, maxAge)).toBe(false);
    });
  });

  describe('syncStarredRepos', () => {
    it('happy path: /user -> starred repos -> lists -> classified envelope persisted, lastSyncAt set', async () => {
      const store = new MemoryStore();
      const testToken = 'ghp_super_secret_test_token_12345';

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith('/user')) {
          return new Response(JSON.stringify({
            login: 'octocat',
            avatar_url: 'https://github.com/images/octocat.png',
            name: 'The Octocat',
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (url.includes('/user/starred')) {
          return new Response(JSON.stringify([
            {
              id: 101,
              name: 'react-app',
              full_name: 'octocat/react-app',
              owner: { login: 'octocat' },
              description: 'Frontend React web application',
              topics: ['react', 'web', 'ui'],
              language: 'TypeScript',
              stargazers_count: 42,
              html_url: 'https://github.com/octocat/react-app',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ]), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Link': '', // Single page
            },
          });
        }

        if (url.endsWith('/graphql')) {
          return new Response(JSON.stringify({
            data: {
              viewer: {
                lists: {
                  nodes: [
                    {
                      id: 'list-1',
                      name: 'My Web Tools',
                      description: 'Frontend tools',
                      items: {
                        pageInfo: { hasNextPage: false },
                        totalCount: 1,
                        nodes: [{ nameWithOwner: 'octocat/react-app' }],
                      },
                    },
                  ],
                },
              },
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response('Not Found', { status: 404 });
      };

      const result = await syncStarredRepos({
        token: testToken,
        store,
      });

      expect(result.listsUnavailable).toBe(false);
      expect(result.stats.total).toBe(1);
      expect(result.stats.newlyClassified).toBe(1);
      expect(result.envelope.username).toBe('octocat');
      expect(result.envelope.repos).toHaveLength(1);
      expect(result.envelope.repos[0].name).toBe('react-app');
      expect(result.envelope.repos[0].lists).toEqual(['My Web Tools']);
      expect(result.envelope.repos[0].category).toBe('Web Frontend');

      // Check persisted data in store
      const persistedDataset = await store.get<DatasetEnvelope>('dataset');
      expect(persistedDataset).toBeDefined();
      expect(persistedDataset?.repos).toHaveLength(1);

      const persistedLogin = await store.get<string>('viewerLogin');
      expect(persistedLogin).toBe('octocat');

      const persistedLastSync = await store.get<string>('lastSyncAt');
      expect(persistedLastSync).toBeTruthy();

      // Assert token NEVER appears in the persisted envelope or cache
      const serialized = JSON.stringify(persistedDataset);
      expect(serialized).not.toContain(testToken);
      expect(serialized).not.toContain('ghp_');

      const serializedCache = JSON.stringify(await store.get('classificationCache'));
      expect(serializedCache).not.toContain(testToken);
      expect(serializedCache).not.toContain('ghp_');
    });

    it('star lists failure -> still succeeds, listsUnavailable true', async () => {
      const store = new MemoryStore();

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/user')) {
          return new Response(JSON.stringify({ login: 'octocat' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/user/starred')) {
          return new Response(JSON.stringify([
            {
              id: 102,
              name: 'backend-service',
              full_name: 'octocat/backend-service',
              owner: { login: 'octocat' },
              description: 'Backend REST API in Go',
              topics: ['api', 'go', 'microservice'],
              language: 'Go',
              stargazers_count: 50,
              html_url: 'https://github.com/octocat/backend-service',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/graphql')) {
          // GraphQL fails (e.g. fine-grained token lacks star lists permission)
          return new Response(JSON.stringify({
            errors: [{ message: 'Resource not accessible by personal access token' }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      };

      const result = await syncStarredRepos({
        token: 'ghp_no_graphql_token',
        store,
      });

      expect(result.listsUnavailable).toBe(true);
      expect(result.stats.total).toBe(1);
      expect(result.envelope.repos[0].name).toBe('backend-service');
      expect(result.envelope.repos[0].lists).toEqual([]);
    });

    it('401 -> invalid_token error, nothing persisted', async () => {
      const store = new MemoryStore();

      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await expect(
        syncStarredRepos({
          token: 'invalid_pat_token',
          store,
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(SyncError);
        const syncErr = err as SyncError;
        expect(syncErr.code).toBe('invalid_token');
        expect(syncErr.status).toBe(401);
        return true;
      });

      expect(await store.get('dataset')).toBeNull();
      expect(await store.get('lastSyncAt')).toBeNull();
      expect(await store.get('viewerLogin')).toBeNull();
    });

    it('rate limit 403 with x-ratelimit-remaining: 0 -> rate_limited with reset time', async () => {
      const store = new MemoryStore();
      const futureSec = Math.floor(Date.now() / 1000) + 3600;

      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(futureSec),
          },
        });
      };

      await expect(
        syncStarredRepos({
          token: 'ghp_rate_limited',
          store,
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(SyncError);
        const syncErr = err as SyncError;
        expect(syncErr.code).toBe('rate_limited');
        expect(syncErr.status).toBe(403);
        expect(syncErr.resetTime).toBeInstanceOf(Date);
        return true;
      });

      expect(await store.get('dataset')).toBeNull();
    });

    it('403 with x-ratelimit-remaining: 59 and x-ratelimit-reset present -> insufficient_permissions (NOT rate_limited)', async () => {
      const store = new MemoryStore();
      const futureSec = Math.floor(Date.now() / 1000) + 3600;

      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({ message: 'Resource not accessible by personal access token' }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'x-ratelimit-remaining': '59',
              'x-ratelimit-reset': String(futureSec),
            },
          }
        );
      };

      await expect(
        syncStarredRepos({
          token: 'ghp_no_permissions',
          store,
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(SyncError);
        const syncErr = err as SyncError;
        expect(syncErr.code).toBe('insufficient_permissions');
        expect(syncErr.status).toBe(403);
        expect(syncErr.message).toContain('This token cannot read your stars');
        return true;
      });

      expect(await store.get('dataset')).toBeNull();
    });

    it('403 with retry-after -> rate_limited', async () => {
      const store = new MemoryStore();

      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({ message: 'You have exceeded a secondary rate limit' }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'retry-after': '120',
            },
          }
        );
      };

      await expect(
        syncStarredRepos({
          token: 'ghp_secondary_rate_limited',
          store,
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(SyncError);
        const syncErr = err as SyncError;
        expect(syncErr.code).toBe('rate_limited');
        expect(syncErr.status).toBe(403);
        expect(syncErr.resetTime).toBeInstanceOf(Date);
        return true;
      });

      expect(await store.get('dataset')).toBeNull();
    });

    it('429 -> rate_limited', async () => {
      const store = new MemoryStore();

      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ message: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await expect(
        syncStarredRepos({
          token: 'ghp_too_many_requests',
          store,
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(SyncError);
        const syncErr = err as SyncError;
        expect(syncErr.code).toBe('rate_limited');
        expect(syncErr.status).toBe(429);
        return true;
      });

      expect(await store.get('dataset')).toBeNull();
    });

    it('abort mid-fetch -> aborted error, previous stored dataset unchanged', async () => {
      const store = new MemoryStore();
      const originalEnvelope: DatasetEnvelope = {
        schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00Z',
        username: 'existing-user',
        repos: [],
      };
      await store.set('dataset', originalEnvelope);
      await store.set('viewerLogin', 'existing-user');

      const controller = new AbortController();

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/user')) {
          return new Response(JSON.stringify({ login: 'new-user' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // Abort during starred fetch
        controller.abort();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      await expect(
        syncStarredRepos({
          token: 'ghp_abort_me',
          store,
          signal: controller.signal,
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(SyncError);
        expect((err as SyncError).code).toBe('aborted');
        return true;
      });

      // Previous dataset is completely intact
      const currentStored = await store.get<DatasetEnvelope>('dataset');
      expect(currentStored?.username).toBe('existing-user');
      expect(await store.get('viewerLogin')).toBe('existing-user');
    });

    it('second sync reuses classification cache (classifyRepos cacheHits > 0)', async () => {
      const store = new MemoryStore();

      const fakeRepo = {
        id: 555,
        name: 'cli-tool',
        full_name: 'octocat/cli-tool',
        owner: { login: 'octocat' },
        description: 'Command line terminal utility in Rust',
        topics: ['cli', 'terminal', 'rust'],
        language: 'Rust',
        stargazers_count: 100,
        html_url: 'https://github.com/octocat/cli-tool',
        updated_at: '2026-01-01T00:00:00Z',
      };

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/user')) {
          return new Response(JSON.stringify({ login: 'octocat' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/user/starred')) {
          return new Response(JSON.stringify([fakeRepo]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/graphql')) {
          return new Response(JSON.stringify({ data: { viewer: { lists: { nodes: [] } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      };

      // First sync
      const firstResult = await syncStarredRepos({ token: 'ghp_test', store });
      expect(firstResult.stats.newlyClassified).toBe(1);
      expect(firstResult.stats.cacheHits).toBe(0);

      // Second sync
      const secondResult = await syncStarredRepos({ token: 'ghp_test', store });
      expect(secondResult.stats.cacheHits).toBe(1);
      expect(secondResult.stats.newlyClassified).toBe(0);
    });
  });

  describe('resolveSyncFailure', () => {
    it('clears token and provides banner when cached dataset exists', () => {
      const error = new SyncError('401 Bad credentials', 'invalid_token');
      const res = resolveSyncFailure(error, true);
      expect(res.shouldClearToken).toBe(true);
      expect(res.bannerMessage).toBe('Your token is no longer valid — reconnect');
      expect(res.keepCachedDataset).toBe(true);
      expect(res.showConnectScreen).toBe(false);
    });

    it('clears token and shows connect screen when no cached dataset exists', () => {
      const error = new SyncError('401 Bad credentials', 'invalid_token');
      const res = resolveSyncFailure(error, false);
      expect(res.shouldClearToken).toBe(true);
      expect(res.bannerMessage).toBeNull();
      expect(res.keepCachedDataset).toBe(false);
      expect(res.showConnectScreen).toBe(true);
    });

    it('does not clear token for rate limits or network errors', () => {
      const rateLimitErr = new SyncError('Rate limit', 'rate_limited');
      const res1 = resolveSyncFailure(rateLimitErr, true);
      expect(res1.shouldClearToken).toBe(false);
      expect(res1.keepCachedDataset).toBe(true);

      const networkErr = new SyncError('Network failure', 'network');
      const res2 = resolveSyncFailure(networkErr, false);
      expect(res2.shouldClearToken).toBe(false);
      expect(res2.showConnectScreen).toBe(true);
    });
  });

  describe('ActivityLog Helper (src/lib/activityLog.ts)', () => {
    it('creates bounded ring buffer enforcing capacity and silent overflow', () => {
      const log = createActivityLog(3);
      expect(log.size()).toBe(0);
      expect(log.entries()).toEqual([]);

      log.add({ text: 'First' });
      log.add({ text: 'Second' });
      log.add({ text: 'Third' });
      expect(log.size()).toBe(3);
      expect(log.entries().map(e => e.text)).toEqual(['First', 'Second', 'Third']);

      // 4th entry silently evicts oldest ('First')
      log.add({ text: 'Fourth' });
      expect(log.size()).toBe(3);
      expect(log.entries().map(e => e.text)).toEqual(['Second', 'Third', 'Fourth']);
    });

    it('records entry kinds and defaults to info', () => {
      const log = createActivityLog(10);
      log.add({ text: 'Default kind entry' });
      log.add({ text: 'Warning entry', kind: 'warn' });
      log.add({ text: 'Error entry', kind: 'error' });
      log.add({ text: 'Success entry', kind: 'success' });

      const entries = log.entries();
      expect(entries).toHaveLength(4);
      expect(entries[0].kind).toBe('info');
      expect(entries[1].kind).toBe('warn');
      expect(entries[2].kind).toBe('error');
      expect(entries[3].kind).toBe('success');
      expect(typeof entries[0].ts).toBe('number');
    });

    it('clears all entries and resets size to 0', () => {
      const log = createActivityLog(10);
      log.add({ text: 'To be cleared' });
      expect(log.size()).toBe(1);
      log.clear();
      expect(log.size()).toBe(0);
      expect(log.entries()).toEqual([]);
    });
  });

  describe('Sync Waiting Progress Events', () => {
    it('emits a waiting event before each LLM call with waitingMs', async () => {
      const ambiguousRepo = {
        id: 777,
        name: 'ambiguous-repo',
        full_name: 'octocat/ambiguous-repo',
        owner: { login: 'octocat' },
        description: 'No matching keywords or rules',
        topics: [],
        language: 'C++',
        stargazers_count: 50,
        html_url: 'https://github.com/octocat/ambiguous-repo',
        updated_at: '2026-01-01T00:00:00Z',
      };

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/user')) {
          return new Response(JSON.stringify({ login: 'octocat' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/user/starred')) {
          return new Response(JSON.stringify([ambiguousRepo]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/graphql')) {
          return new Response(JSON.stringify({ data: { viewer: { lists: { nodes: [] } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/chat/completions')) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ category: 'Backend / API', confidence: 0.9 }) } }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      const progressEvents: SyncProgress[] = [];
      const store = new MemoryStore();

      await syncStarredRepos({
        token: 'ghp_test_token',
        store,
        llm: {
          provider: 'openai',
          apiKey: 'sk-test',
          minIntervalMs: 2500,
        },
        onProgress: p => {
          progressEvents.push(p);
        },
      });

      const waitingEvents = progressEvents.filter(p => p.phase === 'waiting');
      expect(waitingEvents.length).toBeGreaterThan(0);
      expect(waitingEvents[0].waitingMs).toBe(2500);
      expect(waitingEvents[0].repoName).toBe('ambiguous-repo');
    });
  });

  describe('Persistent Sync Log in Storage Layer (src/lib/storage/datasetStore.ts)', () => {
    it('roundtrips log entries through appendSyncLog and getSyncLog', async () => {
      const store = new MemoryStore();
      await appendSyncLog({ ts: 1000, text: 'First event', kind: 'info' }, { store });
      await appendSyncLog({ ts: 2000, text: 'Second event', kind: 'warn' }, { store });

      const logs = await getSyncLog(store);
      expect(logs).toHaveLength(2);
      expect(logs[0]).toEqual({ ts: 1000, text: 'First event', kind: 'info' });
      expect(logs[1]).toEqual({ ts: 2000, text: 'Second event', kind: 'warn' });
    });

    it('caps log at 500 entries, silently evicting oldest entries on overflow', async () => {
      const store = new MemoryStore();
      for (let i = 1; i <= 520; i++) {
        await appendSyncLog({ ts: i, text: `Event #${i}`, kind: 'info' }, { store, capacity: 500 });
      }

      const logs = await getSyncLog(store);
      expect(logs).toHaveLength(500);
      expect(logs[0].text).toBe('Event #21');
      expect(logs[499].text).toBe('Event #520');
    });

    it('defensively drops entries containing Bearer headers or configured keys', async () => {
      const store = new MemoryStore();
      const apiKey = 'sk-proj-supersecretkey123456789';
      const pat = 'ghp_secrettokenabc123456789';

      // Safe entries
      await appendSyncLog({ ts: 1, text: 'Fetching stars — page 1', kind: 'info' }, { store, storedKeys: [apiKey, pat] });

      // Dropped entries
      await appendSyncLog({ ts: 2, text: 'Sending Authorization: Bearer abcdef123456', kind: 'info' }, { store, storedKeys: [apiKey, pat] });
      await appendSyncLog({ ts: 3, text: `Called OpenAI with key ${apiKey}`, kind: 'info' }, { store, storedKeys: [apiKey, pat] });
      await appendSyncLog({ ts: 4, text: `GitHub PAT ${pat} loaded`, kind: 'info' }, { store, storedKeys: [apiKey, pat] });

      const logs = await getSyncLog(store);
      expect(logs).toHaveLength(1);
      expect(logs[0].text).toBe('Fetching stars — page 1');
    });

    it('clearSyncLog removes all persistent entries', async () => {
      const store = new MemoryStore();
      await appendSyncLog({ ts: 1, text: 'To be cleared', kind: 'info' }, { store });
      expect(await getSyncLog(store)).toHaveLength(1);

      await clearSyncLog(store);
      expect(await getSyncLog(store)).toHaveLength(0);
    });
  });

  describe('Reset AI Classifications (src/lib/sync.ts resetAIClassifications)', () => {
    it('removes LLM cache entries, reverts dataset repos to Other/fallback, keeps rule entries, and persists', async () => {
      const store = new MemoryStore();

      // Seed cache
      const initialCache = {
        'facebook/react': {
          category: 'Web Frontend' as const,
          classification: {
            method: 'rule' as const,
            confidence: 0.85,
            classifiedAt: '2026-03-01T00:00:00Z',
            inputHash: 'hash-react',
          },
        },
        'octocat/ambiguous-1': {
          category: 'Backend / API' as const,
          classification: {
            method: 'llm' as const,
            confidence: 0.9,
            classifiedAt: '2026-03-01T00:00:00Z',
            inputHash: 'hash-ambig-1',
          },
        },
        'octocat/ambiguous-2': {
          category: 'CLI / Tools' as const,
          classification: {
            method: 'llm' as const,
            confidence: 0.88,
            classifiedAt: '2026-03-01T00:00:00Z',
            inputHash: 'hash-ambig-2',
          },
        },
      };

      // Seed dataset
      const initialDataset: DatasetEnvelope = {
        schemaVersion: 1,
        username: 'octocat',
        generatedAt: '2026-03-01T00:00:00Z',
        repos: [
          {
            id: 1,
            name: 'react',
            fullName: 'facebook/react',
            owner: 'facebook',
            description: 'UI library',
            topics: ['react'],
            language: 'JavaScript',
            stars: 200000,
            url: 'https://github.com/facebook/react',
            updatedAt: '2026-03-01T00:00:00Z',
            category: 'Web Frontend',
            classification: {
              method: 'rule',
              confidence: 0.85,
              classifiedAt: '2026-03-01T00:00:00Z',
              inputHash: 'hash-react',
            },
          },
          {
            id: 2,
            name: 'ambiguous-1',
            fullName: 'octocat/ambiguous-1',
            owner: 'octocat',
            description: 'Something',
            topics: [],
            language: 'C++',
            stars: 10,
            url: 'https://github.com/octocat/ambiguous-1',
            updatedAt: '2026-03-01T00:00:00Z',
            category: 'Backend / API',
            classification: {
              method: 'llm',
              confidence: 0.9,
              classifiedAt: '2026-03-01T00:00:00Z',
              inputHash: 'hash-ambig-1',
            },
          },
          {
            id: 3,
            name: 'ambiguous-2',
            fullName: 'octocat/ambiguous-2',
            owner: 'octocat',
            description: 'Something else',
            topics: [],
            language: 'Go',
            stars: 20,
            url: 'https://github.com/octocat/ambiguous-2',
            updatedAt: '2026-03-01T00:00:00Z',
            category: 'CLI / Tools',
            classification: {
              method: 'llm',
              confidence: 0.88,
              classifiedAt: '2026-03-01T00:00:00Z',
              inputHash: 'hash-ambig-2',
            },
          },
        ],
      };

      await store.set('classificationCache', initialCache);
      await store.set('dataset', initialDataset);

      const result = await resetAIClassifications({ store });
      expect(result.resetCount).toBe(2);

      // Verify updated cache
      const updatedCache = await store.get<any>('classificationCache');
      expect(updatedCache['facebook/react']).toBeDefined();
      expect(updatedCache['octocat/ambiguous-1']).toBeUndefined();
      expect(updatedCache['octocat/ambiguous-2']).toBeUndefined();

      // Verify updated dataset
      const updatedDataset = await store.get<DatasetEnvelope>('dataset');
      expect(updatedDataset?.repos).toHaveLength(3);
      const reactRepo = updatedDataset?.repos.find(r => r.name === 'react');
      expect(reactRepo?.category).toBe('Web Frontend');
      expect(reactRepo?.classification.method).toBe('rule');

      const ambig1 = updatedDataset?.repos.find(r => r.name === 'ambiguous-1');
      expect(ambig1?.category).toBe('Other');
      expect(ambig1?.classification.method).toBe('fallback');
      expect(ambig1?.classification.confidence).toBe(0.5);

      const ambig2 = updatedDataset?.repos.find(r => r.name === 'ambiguous-2');
      expect(ambig2?.category).toBe('Other');
      expect(ambig2?.classification.method).toBe('fallback');
    });

    it('returns resetCount: 0 when no LLM classifications exist', async () => {
      const store = new MemoryStore();
      await store.set('classificationCache', {
        'facebook/react': {
          category: 'Web Frontend',
          classification: { method: 'rule', confidence: 0.85, inputHash: 'h', classifiedAt: '' },
        },
      });

      const res = await resetAIClassifications({ store });
      expect(res.resetCount).toBe(0);
    });

    it('respects abort signal and leaves cache consistent without mutating store', async () => {
      const store = new MemoryStore();
      const initialCache = {
        'repo/llm': {
          category: 'Mobile' as const,
          classification: { method: 'llm' as const, confidence: 0.9, inputHash: 'h', classifiedAt: '' },
        },
      };
      await store.set('classificationCache', initialCache);

      const controller = new AbortController();
      controller.abort();

      await expect(resetAIClassifications({ store, signal: controller.signal })).rejects.toThrow('aborted');

      const cache = await store.get<any>('classificationCache');
      expect(cache['repo/llm']).toBeDefined();
    });
  });

  describe('Cache Fast Path (src/lib/sync.ts)', () => {
    it('skips classification phase entirely and makes 0 AI calls when all repos are cache hits', async () => {
      const store = new MemoryStore();
      const cachedRepo = {
        id: 999,
        name: 'cached-repo',
        full_name: 'octocat/cached-repo',
        owner: { login: 'octocat' },
        description: 'Cached description',
        topics: ['web'],
        language: 'TypeScript',
        stargazers_count: 100,
        html_url: 'https://github.com/octocat/cached-repo',
        updated_at: '2026-01-01T00:00:00Z',
      };

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/user')) {
          return new Response(JSON.stringify({ login: 'octocat' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/user/starred')) {
          return new Response(JSON.stringify([cachedRepo]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/graphql')) {
          return new Response(JSON.stringify({ data: { viewer: { lists: { nodes: [] } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error(`Unexpected network call: ${url}`);
      };

      // Pre-seed cache with matching inputHash
      const normalized = {
        id: 999,
        name: 'cached-repo',
        fullName: 'octocat/cached-repo',
        owner: 'octocat',
        description: 'Cached description',
        topics: ['web'],
        language: 'TypeScript',
        stars: 100,
        url: 'https://github.com/octocat/cached-repo',
        updatedAt: '2026-01-01T00:00:00Z',
        archived: false,
        fork: false,
      };
      const { computeInputHash } = await import('../src/core/hash.ts');
      const hash = computeInputHash(normalized);

      await store.set('classificationCache', {
        'octocat/cached-repo': {
          category: 'Web Frontend',
          classification: {
            method: 'llm',
            confidence: 0.95,
            classifiedAt: new Date().toISOString(),
            inputHash: hash,
          },
        },
      });

      const progressEvents: SyncProgress[] = [];
      const result = await syncStarredRepos({
        token: 'ghp_test_fast_path',
        store,
        llm: {
          provider: 'openai',
          apiKey: 'sk-test',
        },
        onProgress: p => {
          progressEvents.push(p);
        },
      });

      expect(result.stats.cacheHits).toBe(1);
      expect(result.stats.newlyClassified).toBe(0);
      expect(result.aiCalls).toBe(0);

      // Verify that a classifying event with message was emitted
      const classifyingEvents = progressEvents.filter(p => p.phase === 'classifying');
      expect(classifyingEvents.length).toBe(1);
      expect(classifyingEvents[0].message).toContain('Classification: 1/1 from cache, 0 AI calls');
    });
  });

  describe('LLM-Other 7-day Retry and Fallback Caching (src/core/classify-repos.ts)', () => {
    const sampleRepo = {
      id: 100,
      name: 'ambiguous-tool',
      fullName: 'org/ambiguous-tool',
      owner: 'org',
      description: 'Obscure tool with no keywords',
      topics: [],
      language: 'Rust',
      stars: 5,
      url: 'https://github.com/org/ambiguous-tool',
      updatedAt: '2026-01-01T00:00:00Z',
      archived: false,
      fork: false,
    };

    it('caches successful LLM answer when category is Other (method llm)', async () => {
      let llmCalls = 0;
      const res = await classifyRepos([sampleRepo], {
        llmClassify: async () => {
          llmCalls++;
          return { category: 'Other', method: 'llm', confidence: 0.7 };
        },
      });

      expect(llmCalls).toBe(1);
      expect(res.repos[0].category).toBe('Other');
      expect(res.repos[0].classification.method).toBe('llm');
      expect(res.cache['org/ambiguous-tool']).toBeDefined();
      expect(res.cache['org/ambiguous-tool'].classification.method).toBe('llm');
    });

    it('treats fresh LLM-Other (< 7 days old) as a cache hit', async () => {
      const { computeInputHash } = await import('../src/core/hash.ts');
      const hash = computeInputHash(sampleRepo);

      const cache = {
        'org/ambiguous-tool': {
          category: 'Other' as const,
          classification: {
            method: 'llm' as const,
            confidence: 0.7,
            classifiedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days old
            inputHash: hash,
          },
        },
      };

      let llmCalls = 0;
      const res = await classifyRepos([sampleRepo], {
        cache,
        llmClassify: async () => {
          llmCalls++;
          return { category: 'Backend / API', method: 'llm', confidence: 0.9 };
        },
      });

      expect(llmCalls).toBe(0);
      expect(res.cacheHits).toBe(1);
      expect(res.repos[0].category).toBe('Other');
    });

    it('treats 8-day-old LLM-Other (> 7 days old) as a cache miss and reclassifies', async () => {
      const { computeInputHash } = await import('../src/core/hash.ts');
      const hash = computeInputHash(sampleRepo);

      const cache = {
        'org/ambiguous-tool': {
          category: 'Other' as const,
          classification: {
            method: 'llm' as const,
            confidence: 0.7,
            classifiedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days old (> 7 days)
            inputHash: hash,
          },
        },
      };

      let llmCalls = 0;
      const res = await classifyRepos([sampleRepo], {
        cache,
        llmClassify: async () => {
          llmCalls++;
          return { category: 'CLI / Tools', method: 'llm', confidence: 0.85 };
        },
      });

      expect(llmCalls).toBe(1);
      expect(res.cacheHits).toBe(0);
      expect(res.newlyClassified).toBe(1);
      expect(res.repos[0].category).toBe('CLI / Tools');
    });

    it('leaves fallback classifications uncached', async () => {
      let llmCalls = 0;
      const res = await classifyRepos([sampleRepo], {
        llmClassify: async () => {
          llmCalls++;
          return { category: 'Other', method: 'fallback', confidence: 0.5 };
        },
      });

      expect(llmCalls).toBe(1);
      expect(res.cache['org/ambiguous-tool']).toBeUndefined();
    });
  });
});
