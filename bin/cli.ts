#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import 'dotenv/config';
import { executeDatasetPipeline, type PipelineResult } from '../scripts/lib/pipeline.ts';

const VERSION = '1.0.0';

const HELP_TEXT = `star-classifier v${VERSION}
Fetch and classify GitHub starred repositories into a structured JSON dataset.

Usage:
  npx star-classifier [options]

Options:
  -u, --user <username>     Target GitHub username (defaults to authenticated user)
      --username <username> Alias for --user
  -t, --token <token>       GitHub Personal Access Token (or GITHUB_TOKEN env var)
  -o, --output <path>       Output JSON file path (default: ./repos.json)
      --gemini-key <key>    Google Gemini API key for hybrid fallback (or GEMINI_API_KEY env var)
      --rule-only           Classify exclusively with deterministic rules (skip LLM calls)
      --cache <path>        Path to isolated classification cache file (default: ./.star-classifier-cache.json)
      --no-cache            Disable classification cache loading and saving
  -h, --help                Show this help message
  -v, --version             Show version number

Examples:
  npx star-classifier --user octocat
  npx star-classifier --token ghp_yourTokenHere
  npx star-classifier --user torvalds -o torvalds-stars.json --rule-only

The generated JSON dataset can be directly imported into the Starred Repos Classifier web dashboard via the "Import JSON" button.
`;

export interface ParsedCliArgs {
  user?: string;
  token?: string;
  output: string;
  geminiKey?: string;
  ruleOnly: boolean;
  cachePath?: string | null;
  noCache: boolean;
  help: boolean;
  version: boolean;
}

export function parseCliArguments(argv: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      user: {
        type: 'string',
        short: 'u',
      },
      username: {
        type: 'string',
      },
      token: {
        type: 'string',
        short: 't',
      },
      output: {
        type: 'string',
        short: 'o',
        default: './repos.json',
      },
      'gemini-key': {
        type: 'string',
      },
      'rule-only': {
        type: 'boolean',
        default: false,
      },
      cache: {
        type: 'string',
      },
      'no-cache': {
        type: 'boolean',
        default: false,
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
      version: {
        type: 'boolean',
        short: 'v',
        default: false,
      },
    },
    strict: true,
    allowPositionals: false,
  });

  const user = values.user || values.username || process.env.GITHUB_USERNAME?.trim() || undefined;
  const token = values.token || process.env.GITHUB_TOKEN?.trim() || undefined;
  const geminiKey = values['gemini-key'] || process.env.GEMINI_API_KEY?.trim() || undefined;
  const noCache = Boolean(values['no-cache']);
  const cachePath = noCache ? null : (values.cache || './.star-classifier-cache.json');

  return {
    user,
    token,
    output: values.output || './repos.json',
    geminiKey,
    ruleOnly: Boolean(values['rule-only']),
    cachePath,
    noCache,
    help: Boolean(values.help),
    version: Boolean(values.version),
  };
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  logger: { log: (msg: string) => void; error: (msg: string) => void } = console
): Promise<PipelineResult | null> {
  let parsed: ParsedCliArgs;
  try {
    parsed = parseCliArguments(argv);
  } catch (err) {
    logger.error(`[star-classifier] Error parsing arguments: ${err instanceof Error ? err.message : String(err)}`);
    logger.error('Run "star-classifier --help" for valid options.');
    return null;
  }

  if (parsed.help) {
    logger.log(HELP_TEXT);
    return null;
  }

  if (parsed.version) {
    logger.log(`v${VERSION}`);
    return null;
  }

  // Validate authentication / target user
  if (!parsed.user && !parsed.token) {
    logger.error('[star-classifier] Error: Target GitHub username or GitHub token required.');
    logger.error('  Provide --user <username> for public stars, or --token <token> for your own stars.');
    logger.error('  Run "star-classifier --help" for examples.');
    return null;
  }

  if (parsed.ruleOnly) {
    logger.log('[star-classifier] Running in rule-only mode (--rule-only). LLM fallback disabled.');
  } else if (!parsed.geminiKey) {
    logger.log('[star-classifier] Notice: No GEMINI_API_KEY provided. Using deterministic rules with fallback to "Other".');
  }

  const resolvedOutputPath = resolve(parsed.output);

  try {
    const result = await executeDatasetPipeline({
      username: parsed.user,
      token: parsed.token,
      geminiKey: parsed.geminiKey,
      ruleOnly: parsed.ruleOnly,
      outputPath: resolvedOutputPath,
      cachePath: parsed.cachePath,
      noCache: parsed.noCache,
      seedReposPath: null, // Strictly prevent seeding from Deniz's dataset
      useOverrides: false,  // Strictly prevent loading Deniz's manual overrides
      logger: {
        log: msg => logger.log(msg),
        warn: msg => logger.log(msg),
        error: msg => logger.error(msg),
      },
    });

    logger.log('\n======================================================');
    logger.log(`[star-classifier] Success! Processed ${result.totalCount} repositories.`);
    logger.log(`[star-classifier] Output saved to: ${result.outputPath}`);
    logger.log('======================================================');
    logger.log('To view and filter your starred repositories:');
    logger.log('  1. Open the Starred Repos Classifier web app');
    logger.log('  2. Click "Import JSON" in the navigation bar');
    logger.log(`  3. Drag and drop "${parsed.output}" into the modal\n`);

    return result;
  } catch (error) {
    logger.error(`[star-classifier] Execution failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Direct CLI invocation check
if (process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')) {
  runCli().then(result => {
    if (!result && !process.argv.includes('-h') && !process.argv.includes('--help') && !process.argv.includes('-v') && !process.argv.includes('--version')) {
      process.exit(1);
    }
  });
}
