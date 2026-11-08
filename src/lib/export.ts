import type { Repository, RepositoryCategory } from '../types/repo.ts';
import type { SortOption } from './sorting.ts';

export interface ExportFilterContext {
  isFiltered: boolean;
  query?: string;
  categories?: RepositoryCategory[];
  languages?: string[];
  list?: string | null;
  sortBy?: SortOption;
  totalCount?: number;
}

export type ExportFormat = 'json' | 'csv' | 'markdown';
export type ExportScope = 'filtered' | 'all';

/**
 * Triggers a client-side file download using a generated Blob and synthetic anchor link.
 * Never makes network requests or contacts any server.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates formatted JSON preserving the complete Repository schema.
 * Directly re-importable into the P2.1 local dataset import feature.
 */
export function generateJson(repos: Repository[]): string {
  return JSON.stringify(repos, null, 2);
}

/**
 * Exports repositories to a JSON file download.
 */
export function exportToJson(repos: Repository[], filename = 'starred-repos.json'): void {
  const content = generateJson(repos);
  downloadFile(content, filename, 'application/json');
}

/**
 * Escapes a single CSV field value according to RFC 4180 rules.
 */
function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  // If the cell contains comma, double-quote, carriage return, or newline, wrap in quotes and escape internal quotes
  if (
    stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Generates an RFC 4180-compliant CSV string with UTF-8 BOM for Excel/Google Sheets compatibility.
 * Columns (exact 13-column order):
 * 1. name, 2. fullName, 3. owner, 4. url, 5. category, 6. stars, 7. language,
 * 8. topics, 9. lists, 10. description, 11. updatedAt, 12. archived, 13. fork
 */
export function generateCsv(repos: Repository[]): string {
  const headers = [
    'name',
    'fullName',
    'owner',
    'url',
    'category',
    'stars',
    'language',
    'topics',
    'lists',
    'description',
    'updatedAt',
    'archived',
    'fork',
  ];

  const rows = repos.map(repo => {
    const topicsStr = Array.isArray(repo.topics) ? repo.topics.join(';') : '';
    const listsStr = Array.isArray(repo.lists) ? repo.lists.join(';') : '';

    return [
      escapeCsvCell(repo.name),
      escapeCsvCell(repo.fullName),
      escapeCsvCell(repo.owner),
      escapeCsvCell(repo.url),
      escapeCsvCell(repo.category),
      escapeCsvCell(repo.stars),
      escapeCsvCell(repo.language ?? ''),
      escapeCsvCell(topicsStr),
      escapeCsvCell(listsStr),
      escapeCsvCell(repo.description ?? ''),
      escapeCsvCell(repo.updatedAt),
      escapeCsvCell(Boolean(repo.archived)),
      escapeCsvCell(Boolean(repo.fork)),
    ].join(',');
  });

  // Prepend UTF-8 BOM (\uFEFF) to guarantee Excel/Sheets renders Turkish and Unicode characters without corruption
  return `\uFEFF${headers.join(',')}\r\n${rows.join('\r\n')}`;
}

/**
 * Exports repositories to an RFC 4180 CSV file download.
 */
export function exportToCsv(repos: Repository[], filename = 'starred-repos.csv'): void {
  const content = generateCsv(repos);
  downloadFile(content, filename, 'text/csv');
}

/**
 * Generates human-readable GitHub-flavored Markdown document with active filter summary.
 */
export function generateMarkdown(repos: Repository[], context?: ExportFilterContext): string {
  const lines: string[] = [];
  const count = repos.length;

  lines.push('# Starred Repositories');
  lines.push('');

  // Metadata block
  const dateStr = new Date().toISOString().split('T')[0];
  const scopeDescription = context?.isFiltered
    ? `Filtered View (${count} of ${context.totalCount ?? count} repositories)`
    : `Complete Dataset (${count} repositories)`;

  lines.push(`> **Export Date:** ${dateStr}  `);
  lines.push(`> **Scope:** ${scopeDescription}  `);

  if (context?.isFiltered) {
    const filterParts: string[] = [];
    if (context.query?.trim()) {
      filterParts.push(`Search: "${context.query.trim()}"`);
    }
    if (context.categories && context.categories.length > 0) {
      filterParts.push(`Categories: ${context.categories.join(', ')}`);
    }
    if (context.languages && context.languages.length > 0) {
      filterParts.push(`Languages: ${context.languages.join(', ')}`);
    }
    if (context.list?.trim()) {
      filterParts.push(`Star List: ${context.list.trim()}`);
    }
    if (context.sortBy && context.sortBy !== 'relevance') {
      filterParts.push(`Sort: ${context.sortBy}`);
    }

    if (filterParts.length > 0) {
      lines.push(`> **Active Filters:** ${filterParts.join(' | ')}  `);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  if (repos.length === 0) {
    lines.push('_No repositories match the export criteria._');
    lines.push('');
    return lines.join('\n');
  }

  // Repository listings
  for (const repo of repos) {
    const starsFormatted = repo.stars.toLocaleString('en-US');
    lines.push(`### [${repo.fullName}](${repo.url}) ⭐ ${starsFormatted}`);

    if (repo.description && repo.description.trim()) {
      lines.push(repo.description.trim());
      lines.push('');
    }

    const metadataItems: string[] = [];
    metadataItems.push(`**Category:** ${repo.category}`);

    if (repo.language) {
      metadataItems.push(`**Language:** ${repo.language}`);
    }

    if (Array.isArray(repo.lists) && repo.lists.length > 0) {
      metadataItems.push(`**Star Lists:** ${repo.lists.join(', ')}`);
    }

    if (Array.isArray(repo.topics) && repo.topics.length > 0) {
      const topicTags = repo.topics.map(t => `\`#${t}\``).join(' ');
      metadataItems.push(`**Topics:** ${topicTags}`);
    }

    const updatedDate = repo.updatedAt ? repo.updatedAt.split('T')[0] : 'Unknown';
    metadataItems.push(`**Updated:** ${updatedDate}`);

    lines.push(metadataItems.map(item => `- ${item}`).join('\n'));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Exports repositories to a Markdown file download.
 */
export function exportToMarkdown(
  repos: Repository[],
  context?: ExportFilterContext,
  filename = 'starred-repos.md'
): void {
  const content = generateMarkdown(repos, context);
  downloadFile(content, filename, 'text/markdown');
}
