import { ALLOWED_CATEGORIES, type Repository, type RepositoryCategory } from '../types/repo.ts';

export interface DatasetValidationResult {
  valid: boolean;
  error?: string;
  data?: Repository[];
}

/**
 * Parses and validates raw JSON string containing a repository dataset.
 * Returns human-readable error messages without exposing raw stack traces.
 */
export function parseAndValidateDataset(jsonString: string): DatasetValidationResult {
  if (!jsonString || !jsonString.trim()) {
    return { valid: false, error: 'The uploaded file is empty.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Syntax error';
    return { valid: false, error: `Invalid JSON format: ${rawMsg}` };
  }

  return validateDataset(parsed);
}

/**
 * Validates a parsed JSON structure against the Repository schema.
 */
export function validateDataset(parsed: unknown): DatasetValidationResult {
  // 1. Must be an array
  if (!Array.isArray(parsed)) {
    return { valid: false, error: 'Dataset must be a JSON array of repositories.' };
  }

  // 2. Cannot be empty
  if (parsed.length === 0) {
    return { valid: false, error: 'Dataset is empty (contains 0 repositories).' };
  }

  const seenIds = new Set<number>();
  const seenFullNames = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const indexLabel = `Item #${i + 1}`;

    // 3. Must be an object
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, error: `${indexLabel} is not a valid repository object.` };
    }

    const repo = item as Partial<Repository>;
    const nameLabel = repo.fullName ? `"${repo.fullName}" (${indexLabel})` : indexLabel;

    // Required field: id
    if (typeof repo.id !== 'number' || isNaN(repo.id)) {
      return { valid: false, error: `${nameLabel} is missing a valid numeric "id".` };
    }
    if (seenIds.has(repo.id)) {
      return { valid: false, error: `Duplicate repository ID (${repo.id}) found at ${nameLabel}.` };
    }
    seenIds.add(repo.id);

    // Required field: name
    if (typeof repo.name !== 'string' || !repo.name.trim()) {
      return { valid: false, error: `${nameLabel} is missing a valid "name".` };
    }

    // Required field: fullName
    if (typeof repo.fullName !== 'string' || !repo.fullName.includes('/') || !repo.fullName.trim()) {
      return { valid: false, error: `${nameLabel} is missing or has an invalid "fullName" (expected "owner/repo").` };
    }
    const lowerFullName = repo.fullName.toLowerCase().trim();
    if (seenFullNames.has(lowerFullName)) {
      return { valid: false, error: `Duplicate repository fullName "${repo.fullName}" found.` };
    }
    seenFullNames.add(lowerFullName);

    // Required field: owner
    if (typeof repo.owner !== 'string' || !repo.owner.trim()) {
      return { valid: false, error: `${nameLabel} is missing a valid "owner".` };
    }

    // Required field: stars
    if (typeof repo.stars !== 'number' || isNaN(repo.stars) || repo.stars < 0) {
      return { valid: false, error: `${nameLabel} has invalid "stars" (must be a non-negative number).` };
    }

    // Required field: url
    if (typeof repo.url !== 'string' || !repo.url.trim()) {
      return { valid: false, error: `${nameLabel} is missing a "url".` };
    }
    try {
      const u = new URL(repo.url);
      if (!['http:', 'https:'].includes(u.protocol)) {
        return { valid: false, error: `${nameLabel} has an invalid URL protocol (expected http: or https:).` };
      }
    } catch {
      return { valid: false, error: `${nameLabel} has a malformed URL: "${repo.url}".` };
    }

    // Required field: updatedAt
    if (typeof repo.updatedAt !== 'string' || isNaN(Date.parse(repo.updatedAt))) {
      return { valid: false, error: `${nameLabel} has an invalid "updatedAt" date timestamp.` };
    }

    // Required field: topics
    if (!Array.isArray(repo.topics) || !repo.topics.every(t => typeof t === 'string')) {
      return { valid: false, error: `${nameLabel} "topics" must be an array of strings.` };
    }

    // Required field: category
    if (!repo.category || !ALLOWED_CATEGORIES.includes(repo.category as RepositoryCategory)) {
      return {
        valid: false,
        error: `${nameLabel} has invalid category "${repo.category}". Must be one of: ${ALLOWED_CATEGORIES.join(', ')}.`,
      };
    }

    // Optional field: lists
    if (repo.lists !== undefined) {
      if (!Array.isArray(repo.lists) || !repo.lists.every(l => typeof l === 'string')) {
        return { valid: false, error: `${nameLabel} "lists" must be an array of strings.` };
      }
    }

    // Required field: classification
    if (!repo.classification || typeof repo.classification !== 'object') {
      return { valid: false, error: `${nameLabel} is missing "classification" metadata.` };
    }
    const { method, inputHash, classifiedAt } = repo.classification;
    if (!method || !['rule', 'llm', 'manual', 'fallback'].includes(method)) {
      return { valid: false, error: `${nameLabel} has invalid classification method "${method}".` };
    }
    if (typeof inputHash !== 'string' || !inputHash.trim()) {
      return { valid: false, error: `${nameLabel} is missing classification "inputHash".` };
    }
    if (typeof classifiedAt !== 'string' || isNaN(Date.parse(classifiedAt))) {
      return { valid: false, error: `${nameLabel} has an invalid classification "classifiedAt" date timestamp.` };
    }
  }

  return {
    valid: true,
    data: parsed as Repository[],
  };
}
