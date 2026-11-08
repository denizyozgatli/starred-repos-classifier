#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distCli = resolve(__dirname, '../dist/bin/cli.js');
const srcCli = resolve(__dirname, './cli.ts');

if (existsSync(distCli)) {
  await import(pathToFileURL(distCli).href);
} else {
  const result = spawnSync('npx', ['tsx', srcCli, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: true,
  });
  process.exit(result.status ?? 0);
}
