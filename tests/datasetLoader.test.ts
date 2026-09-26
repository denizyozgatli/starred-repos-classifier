import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDatasetUrl, fetchDataset } from '../src/lib/datasetLoader.ts';
import type { Repository } from '../src/types/repo.ts';

const VALID_SAMPLE_REPOS: Repository[] = [
  {
    id: 101,
    name: 'test-repo',
    fullName: 'owner/test-repo',
    owner: 'owner',
    description: 'A test repository',
    topics: ['test', 'demo'],
    language: 'TypeScript',
    stars: 42,
    url: 'https://github.com/owner/test-repo',
    updatedAt: '2026-03-01T00:00:00Z',
    category: 'Web Frontend',
    classification: {
      method: 'rule',
      confidence: 0.95,
      classifiedAt: '2026-03-01T00:00:00Z',
      inputHash: 'hash1',
    },
  },
];

describe('datasetLoader', () => {
  describe('getDatasetUrl', () => {
    it('constructs dataset URL for root base path', () => {
      expect(getDatasetUrl('/')).toBe('/data/repos.json');
    });

    it('constructs dataset URL with subpath having trailing slash', () => {
      expect(getDatasetUrl('/starred-repos-classifier/')).toBe('/starred-repos-classifier/data/repos.json');
    });

    it('normalizes subpath missing trailing slash', () => {
      expect(getDatasetUrl('/starred-repos-classifier')).toBe('/starred-repos-classifier/data/repos.json');
    });

    it('normalizes nested base paths', () => {
      expect(getDatasetUrl('/apps/starred/')).toBe('/apps/starred/data/repos.json');
      expect(getDatasetUrl('/apps/starred')).toBe('/apps/starred/data/repos.json');
    });
  });

  describe('fetchDataset', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('successfully loads and validates a valid dataset', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(VALID_SAMPLE_REPOS),
      } as unknown as Response);

      const result = await fetchDataset('/data/repos.json');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0].name).toBe('test-repo');
      expect(result.error).toBeUndefined();
    });

    it('returns error when HTTP response is not ok (e.g. 404 Not Found)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      } as unknown as Response);

      const result = await fetchDataset('/data/repos.json');
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain('HTTP 404');
    });

    it('returns error when HTTP response is a 500 server error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Error',
      } as unknown as Response);

      const result = await fetchDataset('/data/repos.json');
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain('HTTP 500');
    });

    it('returns error when response contains malformed JSON', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '{"invalid": json syntax',
      } as unknown as Response);

      const result = await fetchDataset('/data/repos.json');
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain('Invalid JSON format');
    });

    it('returns error when dataset fails schema validation (e.g. empty array)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '[]',
      } as unknown as Response);

      const result = await fetchDataset('/data/repos.json');
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain('Dataset is empty');
    });

    it('returns error when dataset fails schema validation (missing required fields)', async () => {
      const invalidRepos = [
        {
          id: 1,
          name: 'missing-fields',
        },
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(invalidRepos),
      } as unknown as Response);

      const result = await fetchDataset('/data/repos.json');
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain('missing or has an invalid');
    });

    it('returns error when fetch throws network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch (offline)'));

      const result = await fetchDataset('/data/repos.json');
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toContain('Failed to fetch (offline)');
    });
  });
});
