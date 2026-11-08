import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCliArguments, runCli } from '../bin/cli.ts';
import { executeDatasetPipeline } from '../scripts/lib/pipeline.ts';
import { validateDataset } from '../src/lib/datasetValidation.ts';
import type { NormalizedRepo } from '../scripts/lib/normalize.ts';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MOCK_RAW_REPO: NormalizedRepo = {
  id: 12345,
  name: 'test-project',
  fullName: 'mockowner/test-project',
  owner: 'mockowner',
  description: 'A mock project for CLI testing',
  topics: ['cli', 'tools', 'typescript'],
  language: 'TypeScript',
  stars: 42,
  url: 'https://github.com/mockowner/test-project',
  updatedAt: '2026-09-26T00:00:00Z',
  archived: false,
  fork: false,
};

describe('CLI Argument Parsing & Authentication Resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GITHUB_USERNAME;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses --user and -u flags correctly', () => {
    const parsed1 = parseCliArguments(['--user', 'torvalds']);
    expect(parsed1.user).toBe('torvalds');

    const parsed2 = parseCliArguments(['-u', 'octocat']);
    expect(parsed2.user).toBe('octocat');

    const parsed3 = parseCliArguments(['--username', 'evanw']);
    expect(parsed3.user).toBe('evanw');
  });

  it('parses --token and -t flags correctly', () => {
    const parsed1 = parseCliArguments(['--token', 'ghp_secretToken123']);
    expect(parsed1.token).toBe('ghp_secretToken123');

    const parsed2 = parseCliArguments(['-t', 'ghp_shortSecret']);
    expect(parsed2.token).toBe('ghp_shortSecret');
  });

  it('parses --output and -o flags with default fallback', () => {
    const defaultParsed = parseCliArguments(['--user', 'testuser']);
    expect(defaultParsed.output).toBe('./repos.json');

    const customParsed1 = parseCliArguments(['--output', './custom-output.json']);
    expect(customParsed1.output).toBe('./custom-output.json');

    const customParsed2 = parseCliArguments(['-o', './my-stars.json']);
    expect(customParsed2.output).toBe('./my-stars.json');
  });

  it('parses --gemini-key and --rule-only flags', () => {
    const withKey = parseCliArguments(['--gemini-key', 'gemini-secret-key']);
    expect(withKey.geminiKey).toBe('gemini-secret-key');
    expect(withKey.ruleOnly).toBe(false);

    const ruleOnly = parseCliArguments(['--rule-only']);
    expect(ruleOnly.ruleOnly).toBe(true);
  });

  it('parses --cache and --no-cache flags', () => {
    const defaultCache = parseCliArguments(['--user', 'alice']);
    expect(defaultCache.noCache).toBe(false);
    expect(defaultCache.cachePath).toBe('./.star-classifier-cache.json');

    const customCache = parseCliArguments(['--cache', './tmp/test-cache.json']);
    expect(customCache.noCache).toBe(false);
    expect(customCache.cachePath).toBe('./tmp/test-cache.json');

    const noCache = parseCliArguments(['--no-cache']);
    expect(noCache.noCache).toBe(true);
    expect(noCache.cachePath).toBeNull();
  });

  it('parses --help and --version flags', () => {
    const helpLong = parseCliArguments(['--help']);
    expect(helpLong.help).toBe(true);

    const helpShort = parseCliArguments(['-h']);
    expect(helpShort.help).toBe(true);

    const versionLong = parseCliArguments(['--version']);
    expect(versionLong.version).toBe(true);

    const versionShort = parseCliArguments(['-v']);
    expect(versionShort.version).toBe(true);
  });

  it('resolves credentials from environment variables as fallback', () => {
    process.env.GITHUB_USERNAME = 'env_user';
    process.env.GITHUB_TOKEN = 'env_token';
    process.env.GEMINI_API_KEY = 'env_gemini';

    const parsed = parseCliArguments([]);
    expect(parsed.user).toBe('env_user');
    expect(parsed.token).toBe('env_token');
    expect(parsed.geminiKey).toBe('env_gemini');
  });

  it('CLI flags take precedence over environment variables', () => {
    process.env.GITHUB_USERNAME = 'env_user';
    process.env.GITHUB_TOKEN = 'env_token';

    const parsed = parseCliArguments(['--user', 'cli_user', '--token', 'cli_token']);
    expect(parsed.user).toBe('cli_user');
    expect(parsed.token).toBe('cli_token');
  });
});

describe('CLI Execution & Pipeline Core Isolation', () => {
  const tmpDir = resolve(process.cwd(), 'scratch', 'cli-tests');
  const tmpOutput = resolve(tmpDir, 'test-repos.json');
  const tmpCache = resolve(tmpDir, 'test-cache.json');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    if (existsSync(tmpOutput)) unlinkSync(tmpOutput);
    if (existsSync(tmpCache)) unlinkSync(tmpCache);
  });

  afterEach(() => {
    if (existsSync(tmpOutput)) unlinkSync(tmpOutput);
    if (existsSync(tmpCache)) unlinkSync(tmpCache);
  });

  it('rejects execution when neither username nor token is provided', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const mockLogger = {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
    };

    const originalUser = process.env.GITHUB_USERNAME;
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_USERNAME;
    delete process.env.GITHUB_TOKEN;

    try {
      const result = await runCli([], mockLogger);
      expect(result).toBeNull();
      expect(errors.some(e => e.includes('Target GitHub username or GitHub token required'))).toBe(true);
    } finally {
      if (originalUser) process.env.GITHUB_USERNAME = originalUser;
      if (originalToken) process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('prints help banner when -h is passed', async () => {
    const logs: string[] = [];
    const mockLogger = {
      log: (msg: string) => logs.push(msg),
      error: () => {},
    };

    const result = await runCli(['-h'], mockLogger);
    expect(result).toBeNull();
    expect(logs.some(l => l.includes('star-classifier v') && l.includes('Usage:'))).toBe(true);
  });

  it('prints version when -v is passed', async () => {
    const logs: string[] = [];
    const mockLogger = {
      log: (msg: string) => logs.push(msg),
      error: () => {},
    };

    const result = await runCli(['-v'], mockLogger);
    expect(result).toBeNull();
    expect(logs.some(l => l.includes('v1.0.0'))).toBe(true);
  });

  it('guarantees cache isolation and never seeds from data/repos.json in CLI mode', async () => {
    // Write an isolated test cache
    const testCache = {
      'mockowner/test-project': {
        category: 'Data Engineering' as const,
        classification: {
          method: 'rule' as const,
          confidence: 0.99,
          classifiedAt: '2026-09-26T00:00:00Z',
          inputHash: 'unmatched-hash',
        },
      },
    };
    writeFileSync(tmpCache, JSON.stringify(testCache), 'utf-8');

    // Spy on GitHub fetch to return controlled repository
    const githubMod = await import('../scripts/lib/github.ts');
    const fetchSpy = vi.spyOn(githubMod, 'fetchAllStarredRepos').mockResolvedValue([MOCK_RAW_REPO]);

    try {
      const result = await executeDatasetPipeline({
        username: 'mockowner',
        outputPath: tmpOutput,
        cachePath: tmpCache,
        seedReposPath: null, // Isolated: do NOT seed from data/repos.json
        useOverrides: false,  // Isolated: do NOT load data/overrides.json
        ruleOnly: true,
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      });

      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].fullName).toBe('mockowner/test-project');
      // Rule classification for 'cli, tools' gives 'CLI / Tools', not the overridden or Deniz's category
      expect(result.repos[0].category).toBe('CLI / Tools');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('guarantees that manual overrides are NOT applied when useOverrides is false', async () => {
    const tmpOverrides = resolve(tmpDir, 'test-overrides.json');
    writeFileSync(
      tmpOverrides,
      JSON.stringify({ 'mockowner/test-project': { category: 'Security' } }),
      'utf-8'
    );

    const githubMod = await import('../scripts/lib/github.ts');
    const fetchSpy = vi.spyOn(githubMod, 'fetchAllStarredRepos').mockResolvedValue([MOCK_RAW_REPO]);

    try {
      const result = await executeDatasetPipeline({
        username: 'mockowner',
        outputPath: tmpOutput,
        overridesPath: tmpOverrides,
        noCache: true,
        useOverrides: false, // CLI default: overrides disabled
        ruleOnly: true,
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      });

      expect(result.repos).toHaveLength(1);
      // Because useOverrides is false, it is NOT overridden to 'Security', stays 'CLI / Tools'
      expect(result.repos[0].category).toBe('CLI / Tools');
      expect(result.outputPath).toBe(tmpOutput);
      expect(existsSync(tmpOutput)).toBe(true);
    } finally {
      fetchSpy.mockRestore();
      if (existsSync(tmpOverrides)) unlinkSync(tmpOverrides);
    }
  });

  it('generates an output dataset that strictly passes the frontend validator', async () => {
    const githubMod = await import('../scripts/lib/github.ts');
    const fetchSpy = vi.spyOn(githubMod, 'fetchAllStarredRepos').mockResolvedValue([MOCK_RAW_REPO]);

    try {
      const result = await executeDatasetPipeline({
        username: 'mockowner',
        outputPath: tmpOutput,
        noCache: true,
        ruleOnly: true,
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      });

      // Validate result with P2.1 validator
      const validation = validateDataset(result.repos);
      expect(validation.valid).toBe(true);
      expect(validation.error).toBeUndefined();
      expect(validation.data).toHaveLength(1);
      expect(validation.data?.[0].fullName).toBe('mockowner/test-project');
      expect(validation.data?.[0].classification.method).toBe('rule');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
