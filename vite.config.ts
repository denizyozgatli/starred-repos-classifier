import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function staticDataPlugin(): Plugin {
  let isSsrBuild = false;

  return {
    name: 'static-data-plugin',
    configResolved(config) {
      isSsrBuild = Boolean(config.build?.ssr);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split('?')[0] : '';
        if (url.endsWith('/data/repos.json')) {
          const filePath = path.resolve(__dirname, 'data/repos.json');
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(filePath, 'utf-8'));
            return;
          }
        }
        next();
      });
    },
    generateBundle() {
      if (isSsrBuild) return;
      const filePath = path.resolve(__dirname, 'data/repos.json');
      if (fs.existsSync(filePath)) {
        this.emitFile({
          type: 'asset',
          fileName: 'data/repos.json',
          source: fs.readFileSync(filePath, 'utf-8'),
        });
      }
    },
  };
}

// Determine base path for portable deployment:
// 1. Explicit BASE_PATH environment variable (e.g. root domain, Vercel, Netlify)
// 2. In GitHub Actions (CI): dynamically derive repository subpath from GITHUB_REPOSITORY
// 3. Fallback: default to '/starred-repos-classifier/' to preserve current production default
const getBasePath = (): string => {
  if (process.env.BASE_PATH) {
    return process.env.BASE_PATH;
  }
  if (process.env.GITHUB_REPOSITORY) {
    const repoName = process.env.GITHUB_REPOSITORY.split('/')[1];
    if (repoName) {
      return `/${repoName}/`;
    }
  }
  return '/starred-repos-classifier/';
};

// https://vite.dev/config/
export default defineConfig({
  base: getBasePath(),
  plugins: [react(), staticDataPlugin()],
  server: {
    port: 3000,
    open: false,
  },
});
