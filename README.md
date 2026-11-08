# GitHub Starred Repositories Classifier

A privacy-first, client-side web dashboard and standalone CLI to fetch, categorize, and explore your GitHub starred repositories.

The project consists of two decoupled components:
- **CLI (`star-classifier`)**: Fetches your starred repositories, classifies them with a hybrid rule/LLM engine, and saves a local JSON dataset.
- **Web Dashboard**: A static single-page application where you import your dataset to search, filter, and inspect your stars entirely in browser memory.

[Live Demo](https://denizyozgatli.github.io/starred-repos-classifier/) · [GitHub Repository](https://github.com/denizyozgatli/starred-repos-classifier)

## Why It Exists

GitHub's default star list quickly becomes unmanageable as stars accumulate over years. While GitHub provides basic search, it lacks structured multi-category taxonomy, deep topical filtering, and local export. This tool turns your starred repositories into an organized personal catalog without sending your data to any third-party server.

## Key Properties

- **Privacy-First & Local**: No central backend, no database, and no server-side storage. Your stars stay on your machine.
- **Decoupled Architecture**: The web dashboard does not make runtime calls to GitHub; all data is loaded via client-side JSON import.
- **Hybrid Classification**: Fast, deterministic rules categorize repositories, with optional Google Gemini LLM fallback for ambiguous entries.
- **Static & Portable**: The dashboard compiles to pure static assets deployable to GitHub Pages, Vercel, Netlify, or any static host.
- **Open Source**: MIT licensed and easy to run locally or self-host.

## Quick Start

### 1. Generate Your Dataset

Run the standalone CLI with your GitHub username:

```bash
npx star-classifier --user <your-github-username>
```

This generates `./repos.json` in your current directory.

> **Authenticated Usage**: To include private star lists and avoid GitHub API rate limits, provide a token:
> `npx star-classifier --token ghp_yourTokenHere`

### 2. View in the Dashboard

Open the [Web Dashboard](https://denizyozgatli.github.io/starred-repos-classifier/) (or run it locally with `npm run dev`), click **Import JSON**, and select your generated `repos.json`.

## CLI

The CLI fetches stars, normalizes metadata, and executes the classification pipeline locally.

```bash
npx star-classifier [options]
```

### Options

| Option | Flag | Description | Default |
|---|---|---|---|
| `--user <username>` | `-u` | GitHub username to fetch stars for | Authenticated user |
| `--token <token>` | `-t` | GitHub Personal Access Token (or `GITHUB_TOKEN`) | None |
| `--output <path>` | `-o` | Destination JSON file path | `./repos.json` |
| `--rule-only` | | Classify strictly with deterministic rules (skip LLM) | `false` |
| `--gemini-key <key>` | | Google Gemini API key for fallback (or `GEMINI_API_KEY`) | None |
| `--cache <path>` | | Classification cache file path | `./.star-classifier-cache.json` |
| `--no-cache` | | Disable reading and writing the classification cache | `false` |
| `--help` | `-h` | Display usage instructions | |
| `--version` | `-v` | Display version number | |

## How Classification Works

Each repository is assigned to one category:

1. **Deterministic rules** — analyzes repository name, topics, description, and language.
2. **Optional Gemini fallback** — ambiguous repositories can be classified with Gemini.
3. **Safe default** — repositories that cannot be confidently classified are assigned to `Other`.

### Supported Categories

- **Web Frontend** (UI, component libraries, web apps) · **Backend / API** (frameworks, SDKs, services)
- **DevOps / Infra** (containers, Kubernetes, CI/CD) · **ML / AI** (machine learning, LLMs, neural models)
- **Data Engineering** (pipelines, ETL, analytics engines) · **CLI / Tools** (utilities, desktop apps)
- **Learning / Docs** (tutorials, handbooks, roadmaps) · **Mobile** (Android, iOS, cross-platform)
- **Security** (OSINT, cryptography, penetration testing) · **Other** (unclassified, assets, non-software)

## Dashboard

The web dashboard is an interactive client-side catalog:

- **Fuzzy Search**: Real-time typo-tolerant search across repository names, descriptions, and topics.
- **Contextual Faceted Filters**: Multi-select categories, programming languages, and GitHub Star Lists with dynamic counts.
- **Sorting**: Order by star count, recent updates, repository name, or search relevance.
- **URL State**: Filter selections and queries are reflected in the URL for bookmarking and sharing.
- **Client-Side Export**: Export filtered subsets or full datasets to JSON, RFC 4180 CSV (with UTF-8 BOM for Excel), or Markdown.
- **In-Memory Import**: Datasets load directly into browser state without server uploads.

## Architecture

```text
User Machine
  │
  ├── 1. Run CLI ──────────> GitHub REST/GraphQL API (fetch stars & lists)
  │                                │
  │                                ▼
  │                       Rule & Gemini Engine
  │                                │
  │                                ▼
  │                         ./repos.json (user-owned local file)
  │                                │
  └── 2. Import JSON ──────────────┘
          │
          ▼
   Static Web Dashboard (100% in-browser state, zero backend calls)
```

## Tech Stack

- **Runtime & Language**: Node.js (>=18.11), TypeScript
- **Web App**: React 19, Tailwind CSS, Lucide icons, Fuse.js
- **Build & Bundler**: Vite 6, Vitest
- **LLM Integration**: `@google/genai` (Gemini API)

## Project Structure

```text
├── bin/        # Standalone CLI entrypoint (cli.ts)
├── data/       # Benchmark & unseen test fixtures for evaluation
├── scripts/    # Ingestion, classification, and evaluation scripts (lib/)
├── src/        # Static React application (components/, lib/, types/)
└── tests/      # Unit and integration test suites
```

## Local Development

```bash
# Clone and install dependencies
git clone https://github.com/denizyozgatli/starred-repos-classifier.git
cd starred-repos-classifier && npm install

npm run dev                    # Start local development server
npm run cli -- --user octocat  # Run CLI locally
npm run build                  # Build web application and CLI bundle
```

### Environment Configuration (Optional)

Create a `.env` file to supply default credentials for local runs:

```env
GITHUB_USERNAME=your-username
GITHUB_TOKEN=ghp_your_personal_access_token
GEMINI_API_KEY=your_gemini_api_key
```

## Testing

```bash
npm test                 # Run all unit and integration test suites
npm run evaluate         # Evaluate classifier against development benchmark
npm run evaluate:unseen  # Evaluate classifier against independent unseen test set
```

*Note: Files in `data/` (`benchmark.json`, `unseen-test.json`) are evaluation fixtures used solely for testing model accuracy, not personal user datasets.*

## Deployment / Self-Hosting

The dashboard compiles to static HTML, CSS, and JavaScript in `dist/`. Deploy the `dist/` directory to any static hosting provider:

- **GitHub Pages**: Included workflow builds and deploys on pushes to `master`.
- **Vercel / Netlify / Cloudflare Pages**: Set build command to `npm run build` and publish directory to `dist`.
- **Docker / Nginx**: Serve `dist/` directly with Nginx or Caddy.

Each user generates their own `repos.json` locally and imports it into the hosted dashboard.

## Privacy & Data Ownership

- **Credentials**: Your GitHub token and Gemini API key remain in your local environment.
- **Direct Requests**: The CLI communicates directly with GitHub and Google APIs without telemetry or proxies.
- **Local Datasets**: Generated JSON files are stored on your machine and ignored by Git.
- **In-Memory Execution**: The web dashboard does not upload files or transmit imported data across the network.
- **No Bundled Data**: The repository ships with zero personal starred datasets.

## License

MIT © 2026 Deniz Yozgatlı
