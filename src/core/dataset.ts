import { CURRENT_SCHEMA_VERSION, type DatasetEnvelope, type Repository } from './types.ts';

export interface BuildDatasetEnvelopeOptions {
  username?: string;
  generatedAt?: string;
}

/**
 * Wraps an array of repositories into the standardized versioned DatasetEnvelope format.
 */
export function buildDatasetEnvelope(
  repos: Repository[],
  options: BuildDatasetEnvelopeOptions = {}
): DatasetEnvelope {
  const generatedAt = options.generatedAt || new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    generatedAt,
    ...(options.username ? { username: options.username } : {}),
    source: {
      type: 'github-stars',
      ...(options.username ? { username: options.username } : {}),
    },
    repos,
  };
}

/**
 * Extracts an array of repositories from either a legacy bare Repository[] array or a versioned DatasetEnvelope.
 * Returns null if the structure is invalid.
 */
export function extractRepos(data: unknown): Repository[] | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data as Repository[];
  }
  if (typeof data === 'object' && data !== null && 'repos' in data) {
    const envelope = data as { repos?: unknown };
    if (Array.isArray(envelope.repos)) {
      return envelope.repos as Repository[];
    }
  }
  return null;
}
