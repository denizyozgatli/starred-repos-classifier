# GitHub Starred Repositories Classifier

A privacy-first, in-browser web dashboard and standalone CLI to fetch, categorize, and explore your GitHub starred repositories.

- **Web Dashboard**: Connect directly with a GitHub Personal Access Token in the browser to fetch, classify (deterministic rules + optional Gemini AI), search, and filter your stars with IndexedDB local caching. JSON import remains available as a secondary fallback.
- **CLI (`npm run cli`)**: A local Node CLI to run the ingestion and classification pipeline from a clone, producing a portable JSON dataset.

[Live Demo](https://denizyozgatli.github.io/starred-repos-classifier/) · [GitHub Repository](https://github.com/denizyozgatli/starred-repos-classifier)

## Why It Exists

GitHub's default star list quickly becomes unmanageable as stars accumulate over years. While GitHub provides basic search, it lacks structured multi-category taxonomy, deep topical filtering, and local export. This tool turns your starred repositories into an organized personal catalog without sending your data to any third-party server.

## Key Properties

- **Privacy-First & Local**: No central backend, no tracking, and no server-side database. Your token and stars stay in your browser.
- **Direct Browser Connection**: The web dashboard connects directly to `api.github.com` via CORS using your personal access token; local JSON import remains available as a fallback.
- **Hybrid Classification**: Fast, deterministic rules categorize repositories instantly, with optional in-browser multi-provider LLM fallback (OpenAI, Anthropic Claude, Google Gemini, DeepSeek) for ambiguous entries.
- **Offline & Cached**: Starred repositories and classifications are cached locally in browser IndexedDB with automatic background refresh (6-hour window).
- **Static & Portable**: The dashboard compiles to pure static assets deployable to GitHub Pages, Vercel, Netlify, or any static host.
- **Open Source**: MIT licensed and easy to run locally or self-host.

## Quick Start

### 1. Open the Dashboard

Visit the [Live Demo](https://denizyozgatli.github.io/starred-repos-classifier/) or run the app locally:

```bash
git clone https://github.com/denizyozgatli/starred-repos-classifier.git
cd starred-repos-classifier && npm install
npm run dev
```

### 2. Connect Your GitHub Account

1. Click **Connect** on the dashboard.
2. Paste your GitHub Personal Access Token (see [Create a GitHub Token](#create-a-github-token) below).
3. The browser fetches your stars (+ Star Lists), classifies them with rules, and caches the dataset in IndexedDB.

#### Alternative: Import a JSON File

If you prefer not to enter a token in the UI or already have a generated dataset, click **Import JSON** in the header or on the welcome screen to load a local `repos.json` file.

### Create a GitHub Token

To read your starred repositories directly from the browser, create a fine-grained personal access token:

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).
2. Set a name (e.g. `starred-repos-classifier`) and expiration.
3. Under **Repository access**, choose **Public repositories (read-only)** if you only starred public repos; choose **All repositories** if you starred any private repositories (**Starring** stays **Read-only** either way).
4. Under **Account permissions**, locate **Starring** and select **Read-only**.
5. Click **Generate token** and copy the value.

> **Token Privacy & Security**:
> - The token is stored **only in your browser** (`sessionStorage` by default, or `localStorage` if you check "Remember on this device").
> - The token is sent **strictly to `api.github.com`** via direct HTTPS requests — never to any intermediate server or proxy.
> - Classic personal access tokens (`ghp_`) are also supported; include the `repo` scope if you want to fetch private GitHub Star Lists.

#### Troubleshooting

- **"I see fewer repositories than my GitHub profile shows."** — The token cannot see private repositories. Create the token with Repository access "All repositories" (Account permissions → Starring → Read-only), reconnect in the app, and refresh.
- **"The token page always shows 'Public repositories (read-only)'."** — That line is permanent: every fine-grained token can always read public repositories. It does not mean your "All repositories" selection was reset — open the token, click Edit, and check the Repository access radio to verify.
- **"Some private repositories are still missing."** — Repositories owned by an organization appear only if that organization allows fine-grained personal access tokens (org policy). A classic token (`ghp_`) with the `repo` scope is an alternative.

### Optional: AI Classification

The classifier uses deterministic rules by default (zero external API keys required). The rule engine is always the default and the LLM only fills rule gaps. Removing the key or an expired/invalid key never changes existing categories.

If you want an AI model to automatically categorize ambiguous repositories that rules cannot resolve:

1. Click the **Settings** (gear icon) button in the dashboard header.
2. Select your AI provider and enter your API key.
3. Choose whether to remember the key on this device, select your preferred model, and adjust rate limiting if desired.
4. Click **Re-classify 'Other' repos** to run AI classification against repositories currently categorized as `Other`.

| Provider | Where to get a key | Notes |
|---|---|---|
| **Google Gemini** | [Google AI Studio](https://aistudio.google.com/) | Direct browser calls to Google's API. Default model: `gemini-3.8-flash`, default delay: 4s. Restrict the key by HTTP referrer where supported (Google AI Studio / Cloud Console). |
| **OpenAI** | [OpenAI Platform](https://platform.openai.com/api-keys) | Direct browser calls to OpenAI's API. Default model: `gpt-6-luna`, default delay: 1s. Restrict the key by HTTP referrer where supported. |
| **Anthropic (Claude)** | [Anthropic Console](https://console.anthropic.com/) | Direct browser calls to Anthropic's API. Default model: `claude-sonnet-5-5`, default delay: 1s. Anthropic requires the direct-browser-access header (`anthropic-dangerous-direct-browser-access`), which is automatically handled by the app. |
| **DeepSeek** | [DeepSeek Platform](https://platform.deepseek.com/) | Direct browser calls to DeepSeek's API. Default model: `deepseek-chat`, default delay: 1s. DeepSeek keys start with `sk-` like OpenAI's, so the app asks you to pick the provider if ambiguous. |

> **API Key Privacy & Security**:
> - Like the GitHub token, your AI API key is stored only in your browser (`sessionStorage` by default, or `localStorage` when "Remember on this device" is checked) and sent directly from your browser to the chosen provider's official API origin.
> - The application never logs API keys or sends them to any intermediate server.

## CLI

The project includes a standalone Node CLI for users who wish to fetch stars, run classifications offline, or automate datasets from the command line.

Clone the repository and run:

```bash
npm run cli -- [options]
```

### Options

| Option | Flag | Description | Default |
|---|---|---|---|
| `--user <username>` | `-u` | GitHub username to fetch stars for (or `--username`) | Authenticated user |
| `--token <token>` | `-t` | GitHub Personal Access Token (or `GITHUB_TOKEN` env var) | None |
| `--output <path>` | `-o` | Destination JSON file path | `./repos.json` |
| `--rule-only` | | Classify strictly with deterministic rules (skip LLM) | `false` |
| `--gemini-key <key>` | | Google Gemini API key for fallback (or `GEMINI_API_KEY` env var) | None |
| `--cache <path>` | | Classification cache file path | `./.star-classifier-cache.json` |
| `--no-cache` | | Disable reading and writing the classification cache | `false` |
| `--help` | `-h` | Display usage instructions | |
| `--version` | `-v` | Display version number | |

Examples:

```bash
# Fetch and classify public stars with rules only
npm run cli -- --user octocat --rule-only

# Authenticated fetch with Star Lists and custom output file
npm run cli -- --token your_token_here --output ./my-stars.json
```

The generated JSON dataset can be loaded into the dashboard at any time via the **Import JSON** button.

## How Classification Works

Each repository is assigned to one category:

1. **Deterministic rules** — analyzes repository name, topics, description, and language.
2. **Optional AI fallback** — ambiguous repositories can be classified with OpenAI, Anthropic Claude, Google Gemini, or DeepSeek.
3. **Safe default** — repositories that cannot be confidently classified are assigned to `Other`.

### Supported Categories

- **Web Frontend** (UI, component libraries, web apps) · **Backend / API** (frameworks, SDKs, services)
- **DevOps / Infra** (containers, Kubernetes, CI/CD) · **ML / AI** (machine learning, LLMs, neural models)
- **Data Engineering** (pipelines, ETL, analytics engines) · **CLI / Tools** (utilities, desktop apps)
- **Learning / Docs** (tutorials, handbooks, roadmaps) · **Mobile** (Android, iOS, cross-platform)
- **Security** (OSINT, cryptography, penetration testing) · **Other** (unclassified, assets, non-software)

## Dashboard

The web dashboard is an interactive client-side catalog:

- **In-Browser GitHub Sync**: Directly fetches starred repositories and Star Lists from GitHub's REST and GraphQL APIs.
- **Fuzzy Search**: Real-time typo-tolerant search across repository names, descriptions, and topics.
- **Contextual Faceted Filters**: Multi-select categories, programming languages, and GitHub Star Lists with dynamic counts.
- **Sorting**: Order by star count, recent updates, repository name, or search relevance.
- **URL State**: Filter selections and queries are reflected in the URL for bookmarking and sharing.
- **Client-Side Export**: Export filtered subsets or full datasets to JSON, RFC 4180 CSV (with UTF-8 BOM for Excel), or Markdown.
- **Local Storage & IndexedDB**: Datasets and classification caches persist securely in IndexedDB with 6-hour auto-refresh.
- **Fallback JSON Import**: Upload local datasets without connecting a GitHub token.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER RUNTIME                                │
│                                                                             │
│  GitHub Token ───► GitHub REST / GraphQL API ──► Starred Repos + Lists      │
│  (UI / Storage)        (api.github.com)                       │             │
│                                                               ▼             │
│                                                     src/core/ Classifier    │
│                                                     ├── Deterministic Rules │
│  LLM API Key ───► AI Provider API (optional) ───────►└── AI Fallback        │
│  (UI / Storage)   (OpenAI/Anthropic/Google/DeepSeek)          │             │
│                                                               ▼             │
│                                                     IndexedDB Store & Cache │
│                                                               │             │
│                                                               ▼             │
│  Local JSON File ──► Import JSON Fallback ──────► Interactive Web Dashboard │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           SECONDARY CLI PATH (OPTIONAL)                     │
│                                                                             │
│  npm run cli ──► GitHub API ──► Rule & LLM Pipeline ──► Local repos.json    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime & Language**: Node.js (>=18.11), TypeScript
- **Web App**: React 19, Tailwind CSS, Lucide icons, Fuse.js
- **Build & Bundler**: Vite 6, Vitest
- **LLM Integration**: `@google/genai` (Gemini API)

## Project Structure

```text
├── bin/            # Standalone CLI entrypoint (cli.ts)
├── data/           # Benchmark & unseen test fixtures for evaluation
├── scripts/        # CLI pipeline scripts & Node wrappers (lib/)
├── src/            # Browser application
│   ├── components/ # React UI components (Dashboard, Modals, Filters, Cards)
│   ├── core/       # Browser-safe core engine (github, star-lists, classifier, llm, hash, dataset)
│   ├── hooks/      # Custom React hooks (useGitHubSync)
│   ├── lib/        # Pure utilities (sync engine, export, search, sorting, urlState)
│   │   └── storage/# Storage adapters (settings, IndexedDB kv store)
│   └── types/      # TypeScript type definitions and schema constants
└── tests/          # Vitest unit and integration test suites
```

## Local Development

```bash
# Clone and install dependencies
git clone https://github.com/denizyozgatli/starred-repos-classifier.git
cd starred-repos-classifier && npm install

npm run dev                    # Start local development server
npm run cli -- --user octocat  # Run CLI locally
npm run build                  # Build web application to dist/
npm run preview                # Preview production build locally
```

### Environment Configuration (Optional)

Create a `.env` file to supply default credentials for local CLI runs (the web app needs no `.env` file):

```env
GITHUB_USERNAME=your-username
GITHUB_TOKEN=your_github_token_here
GEMINI_API_KEY=your_gemini_api_key_here
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

Users can connect directly to GitHub from their own browser on your deployed instance, or import a pre-generated `repos.json` dataset.

## Privacy & Data Ownership

- **Credentials**: Your GitHub token and Gemini API key remain in your browser storage (`sessionStorage` by default, or `localStorage` if opted in). They are never sent to any server other than GitHub and Google.
- **Direct Requests**: Network calls are made directly from your browser to `api.github.com` and `generativelanguage.googleapis.com` without intermediary backend servers or telemetry.
- **Local Datasets**: Repositories and classifications are stored locally in IndexedDB in your browser.
- **In-Memory & Local Execution**: Uploaded files and imported datasets are processed purely in client-side memory.
- **No Bundled Data**: The repository ships with zero personal starred datasets.

## License

MIT © 2026 Deniz Yozgatlı
