import { describe, it, expect } from 'vitest';
import type { Repository } from '../src/types/repo.ts';
import { validateDataset } from '../src/lib/datasetValidation.ts';
import {
  generateJson,
  generateCsv,
  generateMarkdown,
  type ExportFilterContext,
} from '../src/lib/export.ts';
import { IMPORT_SUPPORT_NOTE } from '../src/components/ExportMenu.tsx';

const SAMPLE_REPOS: Repository[] = [
  {
    id: 1,
    name: 'react',
    fullName: 'facebook/react',
    owner: 'facebook',
    description: 'The library for web, native user interfaces, and "interactive" UIs.',
    topics: ['react', 'ui', 'frontend'],
    lists: ['Frontend Dev', 'Core Libraries'],
    language: 'JavaScript',
    stars: 220000,
    url: 'https://github.com/facebook/react',
    updatedAt: '2026-03-01T12:00:00Z',
    category: 'Web Frontend',
    archived: false,
    fork: false,
    classification: {
      method: 'rule',
      confidence: 0.99,
      classifiedAt: '2026-03-01T12:00:00Z',
      inputHash: 'h1',
    },
  },
  {
    id: 2,
    name: 'fastapi',
    fullName: 'fastapi/fastapi',
    owner: 'fastapi',
    description: 'FastAPI framework\nHigh performance\nEasy to learn',
    topics: ['api', 'python', 'rest'],
    lists: [],
    language: 'Python',
    stars: 80000,
    url: 'https://github.com/fastapi/fastapi',
    updatedAt: '2026-03-10T15:30:00Z',
    category: 'Backend / API',
    archived: false,
    fork: false,
    classification: {
      method: 'rule',
      confidence: 0.98,
      classifiedAt: '2026-03-10T15:30:00Z',
      inputHash: 'h2',
    },
  },
  {
    id: 3,
    name: 'turkish-nlp',
    fullName: 'test/turkish-nlp',
    owner: 'test',
    description: 'Türkçe doğal dil işleme kütüphanesi (ş, ç, ğ, ö, ü, İ, ı).',
    topics: ['nlp', 'türkçe'],
    lists: ['Türkçe Kaynaklar'],
    language: 'Python',
    stars: 1250,
    url: 'https://github.com/test/turkish-nlp',
    updatedAt: '2026-03-15T09:00:00Z',
    category: 'ML / AI',
    archived: true,
    fork: true,
    classification: {
      method: 'llm',
      confidence: 0.95,
      classifiedAt: '2026-03-15T09:00:00Z',
      inputHash: 'h3',
    },
  },
  {
    id: 4,
    name: 'minimal-repo',
    fullName: 'owner/minimal-repo',
    owner: 'owner',
    description: null,
    topics: [],
    lists: [],
    language: null,
    stars: 42,
    url: 'https://github.com/owner/minimal-repo',
    updatedAt: '2026-01-01T00:00:00Z',
    category: 'CLI / Tools',
    classification: {
      method: 'fallback',
      confidence: 0.5,
      classifiedAt: '2026-01-01T00:00:00Z',
      inputHash: 'h4',
    },
  },
];

describe('Data Export Library (src/lib/export.ts)', () => {
  describe('JSON Export', () => {
    it('generates valid, formatted JSON', () => {
      const jsonStr = generateJson(SAMPLE_REPOS);
      expect(() => JSON.parse(jsonStr)).not.toThrow();

      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(4);
      expect(parsed[0].fullName).toBe('facebook/react');
      expect(parsed[2].description).toContain('Türkçe');
    });

    it('produces 100% round-trip compatible JSON with P2.1 dataset validator', () => {
      const jsonStr = generateJson(SAMPLE_REPOS);
      const parsed = JSON.parse(jsonStr);

      const validation = validateDataset(parsed);
      expect(validation.valid).toBe(true);
      expect(validation.error).toBeUndefined();
      expect(validation.data).toHaveLength(4);
      expect(validation.data?.[0].name).toBe('react');
      expect(validation.data?.[0].category).toBe('Web Frontend');
    });

    it('handles empty repository array', () => {
      const jsonStr = generateJson([]);
      expect(jsonStr).toBe('[]');
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toEqual([]);
    });

    it('preserves all metadata fields and classification details', () => {
      const jsonStr = generateJson([SAMPLE_REPOS[0]]);
      const parsed = JSON.parse(jsonStr)[0];

      expect(parsed.id).toBe(1);
      expect(parsed.classification.method).toBe('rule');
      expect(parsed.classification.confidence).toBe(0.99);
      expect(parsed.lists).toEqual(['Frontend Dev', 'Core Libraries']);
    });
  });

  describe('CSV Export', () => {
    it('prepends UTF-8 BOM (\\uFEFF) at index 0 for Excel/Sheets compatibility', () => {
      const csvStr = generateCsv(SAMPLE_REPOS);
      expect(csvStr.charCodeAt(0)).toBe(0xfeff);
      expect(csvStr.startsWith('\uFEFF')).toBe(true);
    });

    it('outputs the exact 13 headers in required order', () => {
      const csvStr = generateCsv(SAMPLE_REPOS);
      const firstLine = csvStr.replace(/^\uFEFF/, '').split('\r\n')[0];
      const expectedHeaders =
        'name,fullName,owner,url,category,stars,language,topics,lists,description,updatedAt,archived,fork';
      expect(firstLine).toBe(expectedHeaders);
    });

    it('escapes fields with commas, quotes, and newlines per RFC 4180', () => {
      const csvStr = generateCsv(SAMPLE_REPOS);
      const lines = csvStr.replace(/^\uFEFF/, '').split('\r\n');

      // Repo 1 has quotes and commas in description: 'The library for web, native user interfaces, and "interactive" UIs.'
      // Should be escaped as: "The library for web, native user interfaces, and ""interactive"" UIs."
      expect(lines[1]).toContain(
        '"The library for web, native user interfaces, and ""interactive"" UIs."'
      );

      // Repo 2 has newlines in description: 'FastAPI framework\nHigh performance\nEasy to learn'
      // RFC 4180 specifies cell with newlines must be enclosed in quotes
      expect(csvStr).toContain('"FastAPI framework\nHigh performance\nEasy to learn"');
    });

    it('formats topics and lists as semicolon-delimited strings', () => {
      const csvStr = generateCsv(SAMPLE_REPOS);
      // Repo 1 topics: ['react', 'ui', 'frontend'] -> react;ui;frontend
      // Repo 1 lists: ['Frontend Dev', 'Core Libraries'] -> Frontend Dev;Core Libraries
      expect(csvStr).toContain('react;ui;frontend');
      expect(csvStr).toContain('Frontend Dev;Core Libraries');
    });

    it('preserves Turkish and Unicode characters without corruption', () => {
      const csvStr = generateCsv(SAMPLE_REPOS);
      expect(csvStr).toContain('Türkçe doğal dil işleme kütüphanesi (ş, ç, ğ, ö, ü, İ, ı).');
      expect(csvStr).toContain('Türkçe Kaynaklar');
    });

    it('correctly formats boolean archived and fork flags', () => {
      const csvStr = generateCsv(SAMPLE_REPOS);
      const lines = csvStr.replace(/^\uFEFF/, '').split('\r\n');

      // Repo 1: archived=false, fork=false
      expect(lines[1].endsWith('false,false')).toBe(true);

      // Repo 3: archived=true, fork=true
      const repo3Line = lines.find(l => l.includes('turkish-nlp'));
      expect(repo3Line?.endsWith('true,true')).toBe(true);
    });

    it('handles null and undefined optional values gracefully', () => {
      const csvStr = generateCsv([SAMPLE_REPOS[3]]);
      const lines = csvStr.replace(/^\uFEFF/, '').split('\r\n');
      const cells = lines[1].split(',');

      // minimal-repo has null language and null description
      expect(cells[0]).toBe('minimal-repo');
      expect(cells[6]).toBe(''); // language
      expect(cells[7]).toBe(''); // topics
      expect(cells[8]).toBe(''); // lists
      expect(cells[9]).toBe(''); // description
    });

    it('returns BOM + headers when exporting empty array', () => {
      const csvStr = generateCsv([]);
      expect(csvStr.charCodeAt(0)).toBe(0xfeff);
      const lines = csvStr.replace(/^\uFEFF/, '').split('\r\n');
      expect(lines[0]).toBe(
        'name,fullName,owner,url,category,stars,language,topics,lists,description,updatedAt,archived,fork'
      );
      expect(lines).toHaveLength(2); // header and trailing empty line from join
    });
  });

  describe('Markdown Export', () => {
    it('generates a formatted markdown document with title and scope', () => {
      const md = generateMarkdown(SAMPLE_REPOS);

      expect(md).toContain('# Starred Repositories');
      expect(md).toContain('> **Export Date:**');
      expect(md).toContain('> **Scope:** Complete Dataset (4 repositories)');
      expect(md).toContain('### [facebook/react](https://github.com/facebook/react) ⭐ 220,000');
      expect(md).toContain('**Category:** Web Frontend');
      expect(md).toContain('**Language:** JavaScript');
      expect(md).toContain('**Star Lists:** Frontend Dev, Core Libraries');
      expect(md).toContain('**Topics:** `#react` `#ui` `#frontend`');
    });

    it('includes active filter summary in header block when filtered', () => {
      const context: ExportFilterContext = {
        isFiltered: true,
        query: 'react',
        categories: ['Web Frontend'],
        languages: ['JavaScript'],
        list: 'Frontend Dev',
        sortBy: 'stars',
        totalCount: 150,
      };

      const md = generateMarkdown([SAMPLE_REPOS[0]], context);

      expect(md).toContain('> **Scope:** Filtered View (1 of 150 repositories)');
      expect(md).toContain(
        '> **Active Filters:** Search: "react" | Categories: Web Frontend | Languages: JavaScript | Star List: Frontend Dev | Sort: stars'
      );
      expect(md).toContain('### [facebook/react](https://github.com/facebook/react)');
      expect(md).not.toContain('fastapi');
    });

    it('handles empty filtered repository list gracefully', () => {
      const context: ExportFilterContext = {
        isFiltered: true,
        query: 'non-existent-query',
        totalCount: 150,
      };

      const md = generateMarkdown([], context);

      expect(md).toContain('> **Scope:** Filtered View (0 of 150 repositories)');
      expect(md).toContain('_No repositories match the export criteria._');
    });

    it('preserves Turkish characters in markdown output', () => {
      const md = generateMarkdown([SAMPLE_REPOS[2]]);
      expect(md).toContain('Türkçe doğal dil işleme kütüphanesi');
      expect(md).toContain('**Star Lists:** Türkçe Kaynaklar');
      expect(md).toContain('`#türkçe`');
    });
  });

  describe('Export Scopes (Filtered vs All)', () => {
    it('allows exporting filtered subset without altering source dataset', () => {
      const allRepos = [...SAMPLE_REPOS];
      const filteredSubset = allRepos.filter(r => r.category === 'Web Frontend');

      expect(filteredSubset).toHaveLength(1);
      expect(allRepos).toHaveLength(4);

      const jsonFiltered = generateJson(filteredSubset);
      const jsonAll = generateJson(allRepos);

      expect(JSON.parse(jsonFiltered)).toHaveLength(1);
      expect(JSON.parse(jsonAll)).toHaveLength(4);
    });

    it('allows exporting all repositories regardless of active filter subset', () => {
      const filteredSubset = [SAMPLE_REPOS[0]];
      const allRepos = SAMPLE_REPOS;

      const csvFiltered = generateCsv(filteredSubset);
      const csvAll = generateCsv(allRepos);

      expect(csvFiltered.includes('fastapi')).toBe(false);
      expect(csvAll.includes('fastapi')).toBe(true);
    });
  });

  describe('Import Support Clarification', () => {
    it('provides the exact English informational note', () => {
      expect(IMPORT_SUPPORT_NOTE).toBe('Import supports JSON files only.');
    });
  });
});
