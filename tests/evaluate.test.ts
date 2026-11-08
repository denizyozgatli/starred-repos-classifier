import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBenchmark, runEvaluation } from '../scripts/lib/benchmark.ts';
import { loadUnseenTest, runUnseenEvaluation } from '../scripts/lib/unseen.ts';
import { ALLOWED_CATEGORIES } from '../src/types/repo.ts';

describe('Classifier Benchmark Evaluation', () => {
  const tempDir = resolve(process.cwd(), 'data');
  const tempBenchmarkPath = resolve(tempDir, 'temp-benchmark.json');
  const tempReposPath = resolve(tempDir, 'temp-repos.json');

  afterEach(() => {
    [tempBenchmarkPath, tempReposPath].forEach(p => {
      if (existsSync(p)) {
        try { unlinkSync(p); } catch { /* ignore */ }
      }
    });
  });

  describe('loadBenchmark', () => {
    it('loads and validates the official benchmark dataset', () => {
      const benchmark = loadBenchmark();
      expect(benchmark).toHaveLength(30);

      // Verify structure of every entry
      benchmark.forEach(entry => {
        expect(entry.fullName).toContain('/');
        expect(ALLOWED_CATEGORIES).toContain(entry.expectedCategory);
        expect(['high', 'boundary']).toContain(entry.confidenceLevel);
        expect(entry.rationale.length).toBeGreaterThan(5);
        expect(entry.evidenceSource.length).toBeGreaterThan(3);
      });
    });

    it('detects duplicate benchmark entries', () => {
      const duplicateData = [
        {
          fullName: 'owner/repo-a',
          expectedCategory: 'ML / AI',
          confidenceLevel: 'high',
          rationale: 'First entry',
          evidenceSource: 'desc',
        },
        {
          fullName: 'owner/repo-a',
          expectedCategory: 'Backend / API',
          confidenceLevel: 'high',
          rationale: 'Duplicate entry',
          evidenceSource: 'desc',
        },
      ];
      writeFileSync(tempBenchmarkPath, JSON.stringify(duplicateData), 'utf-8');

      expect(() => loadBenchmark(tempBenchmarkPath)).toThrow('Duplicate benchmark entry detected');
    });

    it('rejects invalid expected categories', () => {
      const invalidCatData = [
        {
          fullName: 'owner/repo-b',
          expectedCategory: 'NonExistentCategory',
          confidenceLevel: 'high',
          rationale: 'Invalid category test',
          evidenceSource: 'desc',
        },
      ];
      writeFileSync(tempBenchmarkPath, JSON.stringify(invalidCatData), 'utf-8');

      expect(() => loadBenchmark(tempBenchmarkPath)).toThrow('invalid expectedCategory');
    });
  });

  describe('runEvaluation calculation & error detection', () => {
    it('accurately calculates accuracy and reports incorrect classifications', async () => {
      const mockBenchmark = [
        {
          fullName: 'facebook/react',
          expectedCategory: 'Web Frontend',
          confidenceLevel: 'high',
          rationale: 'Famous frontend library',
          evidenceSource: 'desc',
        },
        {
          fullName: 'fastapi/fastapi',
          expectedCategory: 'Web Frontend', // Intentionally wrong expected to verify error reporting
          confidenceLevel: 'high',
          rationale: 'FastAPI web API',
          evidenceSource: 'desc',
        },
      ];
      writeFileSync(tempBenchmarkPath, JSON.stringify(mockBenchmark), 'utf-8');

      const mockRepos = [
        {
          id: 1,
          name: 'react',
          fullName: 'facebook/react',
          owner: 'facebook',
          description: 'Frontend library for React',
          topics: ['react', 'ui', 'frontend'],
          language: 'JavaScript',
          stars: 100,
          url: 'https://github.com/facebook/react',
          updatedAt: '2026-01-01T00:00:00Z',
          category: 'Web Frontend',
          classification: { method: 'rule', confidence: 0.99, classifiedAt: '2026-01-01T00:00:00Z', inputHash: 'h1' },
        },
        {
          id: 2,
          name: 'fastapi',
          fullName: 'fastapi/fastapi',
          owner: 'fastapi',
          description: 'FastAPI framework',
          topics: ['api', 'rest-api', 'backend', 'fastapi'],
          language: 'Python',
          stars: 100,
          url: 'https://github.com/fastapi/fastapi',
          updatedAt: '2026-01-01T00:00:00Z',
          category: 'Backend / API',
          classification: { method: 'rule', confidence: 0.98, classifiedAt: '2026-01-01T00:00:00Z', inputHash: 'h2' },
        },
      ];
      writeFileSync(tempReposPath, JSON.stringify(mockRepos), 'utf-8');

      const result = await runEvaluation({
        benchmarkPath: tempBenchmarkPath,
        reposPath: tempReposPath,
      });

      expect(result.total).toBe(2);
      expect(result.correct).toBe(1);
      expect(result.incorrect).toBe(1);
      expect(result.accuracy).toBe(50.0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].fullName).toBe('fastapi/fastapi');
      expect(result.errors[0].expected).toBe('Web Frontend');
      expect(result.errors[0].predicted).toBe('Backend / API');
    });

    it('detects missing benchmark repositories in the dataset', async () => {
      const benchmarkWithMissing = [
        {
          fullName: 'ghost/missing-repo',
          expectedCategory: 'Other',
          confidenceLevel: 'high',
          rationale: 'Not in dataset',
          evidenceSource: 'none',
        },
      ];
      writeFileSync(tempBenchmarkPath, JSON.stringify(benchmarkWithMissing), 'utf-8');

      const emptyRepos = [
        {
          id: 99,
          name: 'other',
          fullName: 'real/repo',
          owner: 'real',
          description: '',
          topics: [],
          language: null,
          stars: 0,
          url: 'https://github.com/real/repo',
          updatedAt: '2026-01-01T00:00:00Z',
          category: 'Other',
          classification: { method: 'rule', confidence: 0.5, classifiedAt: '2026-01-01T00:00:00Z', inputHash: 'h' },
        },
      ];
      writeFileSync(tempReposPath, JSON.stringify(emptyRepos), 'utf-8');

      await expect(
        runEvaluation({ benchmarkPath: tempBenchmarkPath, reposPath: tempReposPath })
      ).rejects.toThrow('Benchmark repository "ghost/missing-repo" was not found');
    });
  });

  describe('Unseen Test Dataset Validation & Anti-Leakage', () => {
    it('successfully loads and validates data/unseen-test.json with zero overlap', () => {
      const unseen = loadUnseenTest();
      expect(unseen).toHaveLength(30);

      // Verify zero overlap with development benchmark
      const benchmark = loadBenchmark();
      const benchmarkNames = new Set(benchmark.map(b => b.fullName.toLowerCase()));

      for (const entry of unseen) {
        expect(benchmarkNames.has(entry.fullName.toLowerCase())).toBe(false);
        expect(ALLOWED_CATEGORIES).toContain(entry.expectedCategory);
        expect(['high', 'medium', 'boundary']).toContain(entry.confidence);
      }
    });

    it('throws error if an unseen entry overlaps with the benchmark (data leakage)', () => {
      const benchmark = loadBenchmark();
      const leakingEntry = [
        {
          fullName: benchmark[0].fullName, // Intentional leakage
          expectedCategory: 'ML / AI',
          confidence: 'high',
          rationale: 'Leaking entry test',
          evidence: ['test'],
        },
      ];
      const tempUnseenPath = resolve(tempDir, 'temp-unseen.json');
      writeFileSync(tempUnseenPath, JSON.stringify(leakingEntry), 'utf-8');

      try {
        expect(() => loadUnseenTest({ unseenPath: tempUnseenPath })).toThrow('Data leakage error');
      } finally {
        if (existsSync(tempUnseenPath)) unlinkSync(tempUnseenPath);
      }
    });

    it('executes runUnseenEvaluation and returns full metric breakdowns', async () => {
      const result = await runUnseenEvaluation();
      expect(result.total).toBe(30);
      expect(result.correct + result.incorrect).toBe(30);
      expect(result.accuracy).toBeGreaterThan(0);
      expect(result.confidenceBreakdown.high.total).toBeGreaterThan(0);
    });
  });
});
