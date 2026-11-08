import { ALLOWED_CATEGORIES, CURRENT_SCHEMA_VERSION, type Repository } from '../../src/types/repo.ts';

export interface ValidationError {
  index?: number;
  repoFullName?: string;
  field?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validates a list of repositories against the schema and safety requirements.
 * Accepts both legacy bare Repository[] arrays and versioned DatasetEnvelope objects.
 */
export function validateRepos(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: [{ message: 'Dataset must be an array or envelope object.' }],
    };
  }

  let reposArray: unknown[];

  if (Array.isArray(data)) {
    reposArray = data;
  } else {
    const envelope = data as Record<string, unknown>;

    if (envelope.schemaVersion === undefined || envelope.schemaVersion === null) {
      return {
        valid: false,
        errors: [{ message: 'Dataset envelope is missing "schemaVersion".' }],
      };
    }

    if (
      typeof envelope.schemaVersion !== 'number' ||
      !Number.isInteger(envelope.schemaVersion)
    ) {
      return {
        valid: false,
        errors: [{ message: 'Invalid "schemaVersion": must be an integer.' }],
      };
    }

    if (envelope.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return {
        valid: false,
        errors: [
          {
            message: `Unsupported dataset schema version (${envelope.schemaVersion}). This version supports schema version ${CURRENT_SCHEMA_VERSION}.`,
          },
        ],
      };
    }

    if (!('repos' in envelope) || !Array.isArray(envelope.repos)) {
      return {
        valid: false,
        errors: [{ message: 'Dataset envelope is missing a valid "repos" array.' }],
      };
    }

    reposArray = envelope.repos;
  }

  const seenIds = new Set<number>();
  const seenFullNames = new Set<string>();

  (reposArray as unknown[]).forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push({ index, message: 'Repository entry is not an object.' });
      return;
    }

    const repo = item as Partial<Repository>;
    const repoIdentifier = repo.fullName || `Index ${index}`;

    // Required fields: id
    if (typeof repo.id !== 'number' || isNaN(repo.id)) {
      errors.push({ index, repoFullName: repoIdentifier, field: 'id', message: 'Missing or invalid id (must be number).' });
    } else {
      if (seenIds.has(repo.id)) {
        errors.push({ index, repoFullName: repoIdentifier, field: 'id', message: `Duplicate repository ID: ${repo.id}.` });
      }
      seenIds.add(repo.id);
    }

    // Required fields: name
    if (typeof repo.name !== 'string' || !repo.name.trim()) {
      errors.push({ index, repoFullName: repoIdentifier, field: 'name', message: 'Missing or invalid name.' });
    }

    // Required fields: fullName
    if (typeof repo.fullName !== 'string' || !repo.fullName.includes('/')) {
      errors.push({ index, repoFullName: repoIdentifier, field: 'fullName', message: 'Missing or invalid fullName (expected "owner/repo").' });
    } else {
      const lower = repo.fullName.toLowerCase();
      if (seenFullNames.has(lower)) {
        errors.push({ index, repoFullName: repoIdentifier, field: 'fullName', message: `Duplicate repository fullName: ${repo.fullName}.` });
      }
      seenFullNames.add(lower);
    }

    // Required fields: owner
    if (typeof repo.owner !== 'string' || !repo.owner.trim()) {
      errors.push({ index, repoFullName: repoIdentifier, field: 'owner', message: 'Missing or invalid owner.' });
    }

    // Required fields: stars
    if (typeof repo.stars !== 'number' || repo.stars < 0) {
      errors.push({ index, repoFullName: repoIdentifier, field: 'stars', message: 'Stars must be a non-negative number.' });
    }

    // Required fields: url
    if (typeof repo.url !== 'string') {
      errors.push({ index, repoFullName: repoIdentifier, field: 'url', message: 'Missing url.' });
    } else {
      try {
        const parsedUrl = new URL(repo.url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          errors.push({ index, repoFullName: repoIdentifier, field: 'url', message: `Invalid url protocol: ${repo.url}` });
        }
      } catch {
        errors.push({ index, repoFullName: repoIdentifier, field: 'url', message: `Malformed url: ${repo.url}` });
      }
    }

    // Required fields: updatedAt
    if (typeof repo.updatedAt !== 'string' || isNaN(Date.parse(repo.updatedAt))) {
      errors.push({ index, repoFullName: repoIdentifier, field: 'updatedAt', message: `Invalid updatedAt date string: ${repo.updatedAt}` });
    }

    // Required fields: topics
    if (!Array.isArray(repo.topics)) {
      errors.push({ index, repoFullName: repoIdentifier, field: 'topics', message: 'Topics must be an array of strings.' });
    }

    // Optional field: lists
    if (repo.lists !== undefined) {
      if (!Array.isArray(repo.lists) || !repo.lists.every(item => typeof item === 'string')) {
        errors.push({ index, repoFullName: repoIdentifier, field: 'lists', message: 'Lists must be an array of strings.' });
      }
    }

    // Category validation
    if (!repo.category || !ALLOWED_CATEGORIES.includes(repo.category)) {
      errors.push({
        index,
        repoFullName: repoIdentifier,
        field: 'category',
        message: `Invalid category: "${repo.category}". Must be one of: ${ALLOWED_CATEGORIES.join(', ')}`,
      });
    }

    // Classification metadata validation
    if (!repo.classification || typeof repo.classification !== 'object') {
      errors.push({ index, repoFullName: repoIdentifier, field: 'classification', message: 'Missing classification metadata.' });
    } else {
      const { method, inputHash, classifiedAt } = repo.classification;
      if (!['rule', 'llm', 'manual', 'fallback'].includes(method)) {
        errors.push({ index, repoFullName: repoIdentifier, field: 'classification.method', message: `Invalid classification method: ${method}` });
      }
      if (typeof inputHash !== 'string' || !inputHash.trim()) {
        errors.push({ index, repoFullName: repoIdentifier, field: 'classification.inputHash', message: 'Missing or empty inputHash in classification metadata.' });
      }
      if (typeof classifiedAt !== 'string' || isNaN(Date.parse(classifiedAt))) {
        errors.push({ index, repoFullName: repoIdentifier, field: 'classification.classifiedAt', message: 'Invalid classifiedAt timestamp in classification metadata.' });
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
