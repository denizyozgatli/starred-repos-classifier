import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
  },
});
