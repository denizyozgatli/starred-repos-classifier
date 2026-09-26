import type { Repository } from '../types/repo.ts';
import { parseAndValidateDataset, type DatasetValidationResult } from './datasetValidation.ts';

export interface DatasetLoaderResult {
  success: boolean;
  data?: Repository[];
  metadata?: DatasetValidationResult['metadata'];
  error?: string;
}

/**
 * Constructs the canonical runtime dataset URL respecting the Vite base path configuration.
 * Guarantees a single slash between the base path and the data/repos.json resource path.
 */
export function getDatasetUrl(
  baseUrl: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/'
): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}data/repos.json`;
}

/**
 * Fetches and validates the static repository dataset over HTTP at runtime.
 * Uses native fetch() and validates data integrity through parseAndValidateDataset().
 * Returns typed Repository[] on success or a human-readable error description on failure.
 */
export async function fetchDataset(
  url: string = getDatasetUrl()
): Promise<DatasetLoaderResult> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to load repository dataset: HTTP ${response.status} ${response.statusText || 'Error'}`.trim(),
      };
    }

    const jsonText = await response.text();
    const validation = parseAndValidateDataset(jsonText);
    if (!validation.valid || !validation.data) {
      return {
        success: false,
        error: validation.error || 'Dataset schema validation failed.',
      };
    }

    return {
      success: true,
      data: validation.data,
      metadata: validation.metadata,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown network error';
    return {
      success: false,
      error: `Network error loading repository dataset: ${message}`,
    };
  }
}
