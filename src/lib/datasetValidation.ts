import {
  ALLOWED_CATEGORIES,
  CURRENT_SCHEMA_VERSION,
  type Repository,
  type RepositoryCategory,
  type DatasetSource,
} from '../types/repo.ts';

export interface DatasetValidationResult {
  valid: boolean;
  error?: string;
  data?: Repository[];
  metadata?: {
    schemaVersion: number;
    username?: string;
    generatedAt?: string;
    source?: DatasetSource;
  };
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
 * Accepts both legacy bare Repository[] arrays and versioned DatasetEnvelope objects.
 */
export function validateDataset(parsed: unknown): DatasetValidationResult {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: 'Dataset must be a JSON array or envelope object.' };
  }

  let reposArray: unknown[];
  let metadata: DatasetValidationResult['metadata'] = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  if (Array.isArray(parsed)) {
    // Mode A: Legacy / implicit v1 bare array
    if (parsed.length === 0) {
      return { valid: false, error: 'Dataset is empty (contains 0 repositories).' };
    }
    reposArray = parsed;
  } else {
    // Mode B: Explicit v1+ envelope object
    const envelope = parsed as Record<string, unknown>;

    if (envelope.schemaVersion === undefined || envelope.schemaVersion === null) {
      return { valid: false, error: 'Dataset envelope is missing "schemaVersion".' };
    }

    if (
      typeof envelope.schemaVersion !== 'number' ||
      !Number.isInteger(envelope.schemaVersion)
    ) {
      return { valid: false, error: 'Invalid "schemaVersion": must be an integer.' };
    }

    if (envelope.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return {
        valid: false,
        error: `Unsupported dataset schema version (${envelope.schemaVersion}). This version supports schema version ${CURRENT_SCHEMA_VERSION}.`,
      };
    }

    if (!('repos' in envelope) || !Array.isArray(envelope.repos)) {
      return { valid: false, error: 'Dataset envelope is missing a valid "repos" array.' };
    }

    reposArray = envelope.repos;

    metadata = {
      schemaVersion: envelope.schemaVersion,
      ...(typeof envelope.username === 'string' && envelope.username.trim()
        ? { username: envelope.username.trim() }
        : {}),
      ...(typeof envelope.generatedAt === 'string' && envelope.generatedAt.trim()
        ? { generatedAt: envelope.generatedAt.trim() }
        : {}),
      ...(envelope.source &&
      typeof envelope.source === 'object' &&
      !Array.isArray(envelope.source) &&
      (envelope.source as { type?: string }).type === 'github-stars'
        ? { source: envelope.source as DatasetSource }
        : {}),
    };
  }

  const seenIds = new Set<number>();
  const seenFullNames = new Set<string>();

  for (let i = 0; i < reposArray.length; i++) {
    const item = (reposArray as unknown[])[i];
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
    data: reposArray as Repository[],
    metadata,
  };
}
