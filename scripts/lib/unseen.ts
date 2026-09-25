import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALLOWED_CATEGORIES, type Repository, type RepositoryCategory } from '../../src/types/repo.ts';
import { classifyRepo } from './classifier.ts';
import type { NormalizedRepo } from './normalize.ts';
import { loadBenchmark, DEFAULT_BENCHMARK_PATH, DEFAULT_REPOS_PATH } from './benchmark.ts';

export type UnseenConfidence = 'high' | 'medium' | 'boundary';

export interface UnseenTestEntry {
  fullName: string;
  expectedCategory: RepositoryCategory;
  confidence: UnseenConfidence;
  rationale: string;
  evidence: string[];
}

export interface UnseenEvaluationError {
  fullName: string;
  expected: RepositoryCategory;
  predicted: RepositoryCategory;
  method: string;
  confidence: number | null;
  groundTruthConfidence: UnseenConfidence;
  rationale: string;
}

export interface ConfidenceAccuracy {
  confidence: UnseenConfidence;
  total: number;
  correct: number;
  accuracy: number;
}

export interface UnseenCategorySummary {
  category: RepositoryCategory;
  expectedCount: number;
  correctCount: number;
  accuracy: number;
}

export interface UnseenEvaluationResult {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  errors: UnseenEvaluationError[];
  categorySummary: Record<string, UnseenCategorySummary>;
  confidenceBreakdown: Record<UnseenConfidence, ConfidenceAccuracy>;
}

export const DEFAULT_UNSEEN_PATH = resolve(process.cwd(), 'data', 'unseen-test.json');

/**
 * Loads, parses, and rigorously validates the unseen test dataset.
 * Ensures zero overlap with the development benchmark and complete referential integrity with repos.json.
 */
export function loadUnseenTest(options?: {
  unseenPath?: string;
  benchmarkPath?: string;
  reposPath?: string;
}): UnseenTestEntry[] {
  const unseenPath = options?.unseenPath || DEFAULT_UNSEEN_PATH;
  const benchmarkPath = options?.benchmarkPath || DEFAULT_BENCHMARK_PATH;
  const reposPath = options?.reposPath || DEFAULT_REPOS_PATH;

  if (!existsSync(unseenPath)) {
    throw new Error(`Unseen test file not found at ${unseenPath}`);
  }

  const raw = readFileSync(unseenPath, 'utf-8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse unseen test JSON from ${unseenPath}: ${err}`);
  }

  if (!Array.isArray(data)) {
    throw new Error('Unseen test set must be an array of test entries.');
  }

  // Load benchmark set to enforce strict zero data leakage
  const benchmark = loadBenchmark(benchmarkPath);
  const benchmarkNames = new Set(benchmark.map(b => b.fullName.toLowerCase()));

  // Load repos set to enforce referential existence
  if (!existsSync(reposPath)) {
    throw new Error(`Repository data file not found at ${reposPath}`);
  }
  const reposRaw = readFileSync(reposPath, 'utf-8');
  const repos = JSON.parse(reposRaw) as Repository[];
  const existingRepoNames = new Set(repos.map(r => r.fullName.toLowerCase()));

  const seen = new Set<string>();
  const validated: UnseenTestEntry[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`Unseen test entry at index ${i} is not an object.`);
    }

    const { fullName, expectedCategory, confidence, rationale, evidence } = item as Partial<UnseenTestEntry>;

    if (typeof fullName !== 'string' || !fullName.includes('/')) {
      throw new Error(`Unseen test entry at index ${i} has invalid fullName: ${fullName}`);
    }

    const lowerName = fullName.toLowerCase();
    if (seen.has(lowerName)) {
      throw new Error(`Duplicate entry in unseen test set for repository: ${fullName}`);
    }
    seen.add(lowerName);

    // Enforce Zero Overlap with Development Benchmark
    if (benchmarkNames.has(lowerName)) {
      throw new Error(`Data leakage error: Repository "${fullName}" is already in development benchmark!`);
    }

    // Enforce existence in data/repos.json
    if (!existingRepoNames.has(lowerName)) {
      throw new Error(`Repository "${fullName}" was not found in dataset: ${reposPath}`);
    }

    if (!expectedCategory || !ALLOWED_CATEGORIES.includes(expectedCategory)) {
      throw new Error(`Unseen test entry "${fullName}" has invalid expectedCategory: "${expectedCategory}". Allowed: ${ALLOWED_CATEGORIES.join(', ')}`);
    }

    if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'boundary') {
      throw new Error(`Unseen test entry "${fullName}" has invalid confidence: "${confidence}". Must be "high", "medium", or "boundary".`);
    }

    validated.push({
      fullName,
      expectedCategory,
      confidence,
      rationale: rationale || '',
      evidence: Array.isArray(evidence) ? evidence : [],
    });
  }

  return validated;
}

/**
 * Runs the current classifier on the unseen test set and computes accuracy, category breakdowns, and confidence breakdowns.
 */
export async function runUnseenEvaluation(options?: {
  unseenPath?: string;
  benchmarkPath?: string;
  reposPath?: string;
}): Promise<UnseenEvaluationResult> {
  const unseen = loadUnseenTest(options);
  const reposFilePath = options?.reposPath || DEFAULT_REPOS_PATH;

  const reposRaw = readFileSync(reposFilePath, 'utf-8');
  const repos = JSON.parse(reposRaw) as Repository[];
  const repoMap = new Map<string, Repository>(repos.map(r => [r.fullName.toLowerCase(), r]));

  let correct = 0;
  const errors: UnseenEvaluationError[] = [];

  const categorySummary: Record<string, UnseenCategorySummary> = {};
  for (const cat of ALLOWED_CATEGORIES) {
    categorySummary[cat] = { category: cat, expectedCount: 0, correctCount: 0, accuracy: 0 };
  }

  const confidenceBreakdown: Record<UnseenConfidence, ConfidenceAccuracy> = {
    high: { confidence: 'high', total: 0, correct: 0, accuracy: 0 },
    medium: { confidence: 'medium', total: 0, correct: 0, accuracy: 0 },
    boundary: { confidence: 'boundary', total: 0, correct: 0, accuracy: 0 },
  };

  for (const entry of unseen) {
    const repo = repoMap.get(entry.fullName.toLowerCase())!;
    categorySummary[entry.expectedCategory].expectedCount++;
    confidenceBreakdown[entry.confidence].total++;

    const normalized: NormalizedRepo = {
      ...repo,
      archived: Boolean(repo.archived),
      fork: Boolean(repo.fork),
    };

    const result = await classifyRepo(normalized);

    if (result.category === entry.expectedCategory) {
      correct++;
      categorySummary[entry.expectedCategory].correctCount++;
      confidenceBreakdown[entry.confidence].correct++;
    } else {
      errors.push({
        fullName: entry.fullName,
        expected: entry.expectedCategory,
        predicted: result.category,
        method: result.method,
        confidence: result.confidence,
        groundTruthConfidence: entry.confidence,
        rationale: entry.rationale,
      });
    }
  }

  const total = unseen.length;
  const accuracy = total > 0 ? (correct / total) * 100 : 0;

  for (const cat of ALLOWED_CATEGORIES) {
    const s = categorySummary[cat];
    s.accuracy = s.expectedCount > 0 ? (s.correctCount / s.expectedCount) * 100 : 0;
  }

  for (const conf of ['high', 'medium', 'boundary'] as const) {
    const b = confidenceBreakdown[conf];
    b.accuracy = b.total > 0 ? (b.correct / b.total) * 100 : 0;
  }

  return {
    total,
    correct,
    incorrect: total - correct,
    accuracy,
    errors,
    categorySummary,
    confidenceBreakdown,
  };
}
