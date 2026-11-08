import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALLOWED_CATEGORIES, type Repository, type RepositoryCategory } from '../../src/types/repo.ts';
import { extractRepos } from '../../src/core/dataset.ts';
import { classifyRepo } from './classifier.ts';
import type { NormalizedRepo } from './normalize.ts';

export interface BenchmarkEntry {
  fullName: string;
  expectedCategory: RepositoryCategory;
  confidenceLevel: 'high' | 'boundary';
  rationale: string;
  evidenceSource: string;
}

export interface EvaluationError {
  fullName: string;
  expected: RepositoryCategory;
  predicted: RepositoryCategory;
  method: string;
  confidence: number | null;
  confidenceLevel: 'high' | 'boundary';
  rationale: string;
}

export interface CategorySummary {
  category: RepositoryCategory;
  expectedCount: number;
  correctCount: number;
  falsePositives: number;
}

export interface EvaluationResult {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  errors: EvaluationError[];
  categorySummary: Record<string, CategorySummary>;
}

export const DEFAULT_BENCHMARK_PATH = resolve(process.cwd(), 'data', 'benchmark.json');
export const DEFAULT_REPOS_PATH = resolve(process.cwd(), 'data', 'repos.json');

/**
 * Loads and validates the ground-truth benchmark dataset.
 */
export function loadBenchmark(customPath?: string): BenchmarkEntry[] {
  const filePath = customPath || DEFAULT_BENCHMARK_PATH;
  if (!existsSync(filePath)) {
    throw new Error(`Benchmark file not found at ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse benchmark JSON from ${filePath}: ${err}`);
  }

  if (!Array.isArray(data)) {
    throw new Error('Benchmark must be an array of benchmark entries.');
  }

  const seen = new Set<string>();
  const validated: BenchmarkEntry[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`Benchmark entry at index ${i} is not an object.`);
    }

    const { fullName, expectedCategory, confidenceLevel, rationale, evidenceSource } = item as Partial<BenchmarkEntry>;

    if (typeof fullName !== 'string' || !fullName.includes('/')) {
      throw new Error(`Benchmark entry at index ${i} has invalid fullName: ${fullName}`);
    }

    const lowerName = fullName.toLowerCase();
    if (seen.has(lowerName)) {
      throw new Error(`Duplicate benchmark entry detected for repository: ${fullName}`);
    }
    seen.add(lowerName);

    if (!expectedCategory || !ALLOWED_CATEGORIES.includes(expectedCategory)) {
      throw new Error(`Benchmark entry "${fullName}" has invalid expectedCategory: "${expectedCategory}". Allowed: ${ALLOWED_CATEGORIES.join(', ')}`);
    }

    if (confidenceLevel !== 'high' && confidenceLevel !== 'boundary') {
      throw new Error(`Benchmark entry "${fullName}" has invalid confidenceLevel: "${confidenceLevel}". Must be "high" or "boundary".`);
    }

    validated.push({
      fullName,
      expectedCategory,
      confidenceLevel,
      rationale: rationale || '',
      evidenceSource: evidenceSource || '',
    });
  }

  return validated;
}

/**
 * Runs the classifier against the benchmark dataset and calculates accuracy metrics.
 */
export async function runEvaluation(options?: {
  benchmarkPath?: string;
  reposPath?: string;
}): Promise<EvaluationResult> {
  const benchmark = loadBenchmark(options?.benchmarkPath);
  const reposFilePath = options?.reposPath;

  const repoMap = new Map<string, Repository>();
  if (reposFilePath) {
    if (!existsSync(reposFilePath)) {
      throw new Error(`Repository data file not found at ${reposFilePath}`);
    }
    const reposRaw = readFileSync(reposFilePath, 'utf-8');
    const repos = extractRepos(JSON.parse(reposRaw)) || [];
    for (const r of repos) {
      repoMap.set(r.fullName.toLowerCase(), r);
    }
  } else if (existsSync(DEFAULT_REPOS_PATH)) {
    const reposRaw = readFileSync(DEFAULT_REPOS_PATH, 'utf-8');
    const repos = extractRepos(JSON.parse(reposRaw)) || [];
    for (const r of repos) {
      repoMap.set(r.fullName.toLowerCase(), r);
    }
  }

  let correct = 0;
  const errors: EvaluationError[] = [];

  // Initialize category summary
  const summary: Record<string, CategorySummary> = {};
  for (const cat of ALLOWED_CATEGORIES) {
    summary[cat] = { category: cat, expectedCount: 0, correctCount: 0, falsePositives: 0 };
  }

  for (const entry of benchmark) {
    let repo = repoMap.get(entry.fullName.toLowerCase());
    if (!repo) {
      if (reposFilePath) {
        throw new Error(`Benchmark repository "${entry.fullName}" was not found in dataset: ${reposFilePath}`);
      }

      // Synthesize repository from evidenceSource if no dataset file is present
      let description: string | null = null;
      let topics: string[] = [];

      const topicsMatch = entry.evidenceSource.match(/topics:\s*\[([^\]]+)\]/i);
      if (topicsMatch) {
        topics = topicsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
      }
      const descMatch = entry.evidenceSource.match(/desc:\s*(.+)$/i);
      if (descMatch) {
        description = descMatch[1].trim();
      }

      const [owner, name] = entry.fullName.split('/');
      repo = {
        id: Math.floor(Math.random() * 1000000),
        name: name || entry.fullName,
        fullName: entry.fullName,
        owner: owner || 'unknown',
        description,
        topics,
        language: null,
        stars: 100,
        url: `https://github.com/${entry.fullName}`,
        updatedAt: '2026-01-01T00:00:00Z',
        archived: false,
        fork: false,
        category: 'Other',
        classification: {
          method: 'fallback',
          confidence: 0.5,
          classifiedAt: '2026-01-01T00:00:00Z',
          inputHash: '',
        },
      };
    }

    summary[entry.expectedCategory].expectedCount++;

    // Run classifier with NormalizedRepo
    const normalized: NormalizedRepo = {
      ...repo,
      archived: Boolean(repo.archived),
      fork: Boolean(repo.fork),
    };
    const result = await classifyRepo(normalized);

    if (result.category === entry.expectedCategory) {
      correct++;
      summary[entry.expectedCategory].correctCount++;
    } else {
      summary[result.category].falsePositives++;
      errors.push({
        fullName: entry.fullName,
        expected: entry.expectedCategory,
        predicted: result.category,
        method: result.method,
        confidence: result.confidence,
        confidenceLevel: entry.confidenceLevel,
        rationale: entry.rationale,
      });
    }
  }

  const total = benchmark.length;
  const incorrect = total - correct;
  const accuracy = total > 0 ? (correct / total) * 100 : 0;

  return {
    total,
    correct,
    incorrect,
    accuracy,
    errors,
    categorySummary: summary,
  };
}
