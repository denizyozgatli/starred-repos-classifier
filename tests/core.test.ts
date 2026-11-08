import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { computeInputHash } from '../src/core/hash.ts';
import { fetchStarredRepos, getAuthenticatedUser } from '../src/core/github.ts';
import { fetchUserStarLists } from '../src/core/star-lists.ts';

function nodeCryptoReferenceHash(repo: {
  fullName: string;
  description: string | null;
  topics: string[];
  language: string | null;
}): string {
  const topicsArray = Array.isArray(repo.topics) ? repo.topics : [];
  const normalizedTopics = [...topicsArray].map(t => String(t).toLowerCase().trim()).sort().join(',');
  const payload = [
    repo.fullName.toLowerCase().trim(),
    (repo.description || '').trim(),
    normalizedTopics,
    (repo.language || '').toLowerCase().trim(),
  ].join('||');

  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

describe('Shared Core - Hash Parity with node:crypto', () => {
  it('produces byte-identical hash for standard ASCII inputs', () => {
    const input = {
      fullName: 'facebook/react',
      description: 'The library for web and native user interfaces.',
      topics: ['declarative', 'frontend', 'javascript', 'react', 'ui'],
      language: 'JavaScript',
    };
    expect(computeInputHash(input)).toBe(nodeCryptoReferenceHash(input));
  });

  it('produces byte-identical hash with empty topics', () => {
    const input = {
      fullName: 'torvalds/linux',
      description: 'Linux kernel source tree',
      topics: [],
      language: 'C',
    };
    expect(computeInputHash(input)).toBe(nodeCryptoReferenceHash(input));
  });

  it('produces byte-identical hash with null description and null language', () => {
    const input = {
      fullName: 'user/no-meta-project',
      description: null,
      topics: [],
      language: null,
    };
    expect(computeInputHash(input)).toBe(nodeCryptoReferenceHash(input));
  });

  it('produces byte-identical hash with unicode descriptions and special characters', () => {
    const unicodeCases = [
      {
        fullName: 'owner/turkish-repo',
        description: 'Türkçe karakterler: ğüşiöç İĞÜŞÖÇ ve emoji 🚀🌟⚡',
        topics: ['türkçe', 'doğal-dil-işleme'],
        language: 'Python',
      },
      {
        fullName: 'owner/multilingual',
        description: '日本語の解説と中文说明 🚀, accented: café, résumé, naïve',
        topics: ['nlp', 'multilingual'],
        language: 'TypeScript',
      },
      {
        fullName: 'owner/long-description',
        description: 'A'.repeat(500) + ' 🌟 ' + 'B'.repeat(300),
        topics: ['performance', 'stress-test', 'sha256'],
        language: 'Rust',
      },
    ];

    for (const testCase of unicodeCases) {
      expect(computeInputHash(testCase)).toBe(nodeCryptoReferenceHash(testCase));
    }
  });

  it('normalizes topic ordering and whitespace identically to node:crypto reference', () => {
    const inputA = {
      fullName: 'owner/reordered',
      description: '  Spaced description  ',
      topics: [' ZEBRA ', 'alpha', ' BETA '],
      language: ' Go ',
    };
    const inputB = {
      fullName: 'owner/reordered',
      description: 'Spaced description',
      topics: ['alpha', 'beta', 'zebra'],
      language: 'go',
    };

    expect(computeInputHash(inputA)).toBe(nodeCryptoReferenceHash(inputA));
    expect(computeInputHash(inputA)).toBe(computeInputHash(inputB));
  });
});

describe('Shared Core - GitHub Endpoint Selection & Authentication', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Case 1: token only -> calls GET /user/starred', async () => {
    let requestedUrl = '';
    let authHeader: string | null = null;
    let apiVersionHeader: string | null = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      const headers = new Headers(init?.headers);
      authHeader = headers.get('authorization');
      apiVersionHeader = headers.get('x-github-api-version');

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const repos = await fetchStarredRepos({ token: 'ghp_token123' });

    expect(repos).toEqual([]);
    expect(requestedUrl).toBe('https://api.github.com/user/starred?per_page=100&page=1');
    expect(authHeader).toBe('Bearer ghp_token123');
    expect(apiVersionHeader).toBe('2022-11-28');
  });

  it('Case 2: token + own username (case-insensitive) -> calls GET /user/starred', async () => {
    const calledUrls: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calledUrls.push(url);

      if (url === 'https://api.github.com/user') {
        return new Response(JSON.stringify({ login: 'OctoCat', avatar_url: 'https://example.com/avatar.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/starred')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    });

    const repos = await fetchStarredRepos({ token: 'ghp_token123', username: 'octocat' });

    expect(repos).toEqual([]);
    expect(calledUrls).toHaveLength(2);
    expect(calledUrls[0]).toBe('https://api.github.com/user');
    expect(calledUrls[1]).toBe('https://api.github.com/user/starred?per_page=100&page=1');
  });

  it('Case 3: token + other username -> calls GET /users/{username}/starred with Authorization', async () => {
    const calledUrls: string[] = [];
    let starredAuthHeader: string | null = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calledUrls.push(url);

      if (url === 'https://api.github.com/user') {
        return new Response(JSON.stringify({ login: 'octocat' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/starred')) {
        const headers = new Headers(init?.headers);
        starredAuthHeader = headers.get('authorization');
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    });

    const repos = await fetchStarredRepos({ token: 'ghp_token123', username: 'torvalds' });

    expect(repos).toEqual([]);
    expect(calledUrls).toHaveLength(2);
    expect(calledUrls[0]).toBe('https://api.github.com/user');
    expect(calledUrls[1]).toBe('https://api.github.com/users/torvalds/starred?per_page=100&page=1');
    expect(starredAuthHeader).toBe('Bearer ghp_token123');
  });

  it('Case 4: username only -> calls GET /users/{username}/starred without Authorization', async () => {
    let requestedUrl = '';
    let authHeader: string | null = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      const headers = new Headers(init?.headers);
      authHeader = headers.get('authorization');

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const repos = await fetchStarredRepos({ username: 'torvalds' });

    expect(repos).toEqual([]);
    expect(requestedUrl).toBe('https://api.github.com/users/torvalds/starred?per_page=100&page=1');
    expect(authHeader).toBeNull();
  });

  it('getAuthenticatedUser parses profile and sends correct headers', async () => {
    let requestedUrl = '';
    let authHeader: string | null = null;
    let apiVersionHeader: string | null = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      const headers = new Headers(init?.headers);
      authHeader = headers.get('authorization');
      apiVersionHeader = headers.get('x-github-api-version');

      return new Response(JSON.stringify({
        login: 'monalisa',
        avatar_url: 'https://github.com/images/mona.png',
        name: 'Mona Lisa',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const user = await getAuthenticatedUser('secret_token');
    expect(user).toEqual({
      login: 'monalisa',
      avatarUrl: 'https://github.com/images/mona.png',
      name: 'Mona Lisa',
    });
    expect(requestedUrl).toBe('https://api.github.com/user');
    expect(authHeader).toBe('Bearer secret_token');
    expect(apiVersionHeader).toBe('2022-11-28');
  });
});

describe('Shared Core - Star Lists Query Selection', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('picks the VIEWER query when isViewer is true', async () => {
    let capturedBody: { query: string; variables: Record<string, unknown> } | undefined;

    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        data: {
          viewer: {
            lists: {
              pageInfo: { hasNextPage: false, endCursor: null },
              totalCount: 0,
              nodes: [],
            },
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const lists = await fetchUserStarLists({
      token: 'ghp_token',
      isViewer: true,
    });

    expect(lists.size).toBe(0);
    expect(capturedBody).toBeDefined();
    expect(capturedBody!.query).toContain('viewer {');
    expect(capturedBody!.query).not.toContain('user(login:');
    expect(capturedBody!.variables).toEqual({ cursor: null });
  });

  it('picks the USER query when isViewer is false', async () => {
    let capturedBody: { query: string; variables: Record<string, unknown> } | undefined;

    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        data: {
          user: {
            lists: {
              pageInfo: { hasNextPage: false, endCursor: null },
              totalCount: 0,
              nodes: [],
            },
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const lists = await fetchUserStarLists({
      token: 'ghp_token',
      username: 'targetuser',
      isViewer: false,
    });

    expect(lists.size).toBe(0);
    expect(capturedBody).toBeDefined();
    expect(capturedBody!.query).toContain('user(login: $login)');
    expect(capturedBody!.query).not.toContain('viewer {');
    expect(capturedBody!.variables).toEqual({ login: 'targetuser', cursor: null });
  });
});
