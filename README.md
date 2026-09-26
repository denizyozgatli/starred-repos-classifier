# GitHub Starred Repositories Classifier

A fast, responsive, and minimal personal web catalog that automatically fetches your GitHub starred repositories, classifies them into practical categories using a hybrid deterministic-rule and Gemini LLM pipeline, and serves an instant client-side browser with fuzzy search, faceted filtering, and sorting.

**Live Production Site:** [https://denizyozgatli.github.io/starred-repos-classifier/](https://denizyozgatli.github.io/starred-repos-classifier/)

The application runs entirely as a static frontend with no runtime backend server. All repository metadata and classifications are precomputed at pipeline execution time, validated, and statically bundled.

---

## Features

- **Automated Repository Classification**: Classifies starred repositories using deterministic rules based on language, topics, name, and description, falling back to Gemini for ambiguous metadata.
- **Fast Client-Side Search (<100ms)**: Real-time fuzzy searching across repository names, owners, descriptions, topics, and languages via Fuse.js.
- **Search Usability**: Accessible `/` keyboard shortcut to focus search, a custom clear button, and suppression of duplicate browser-native search cancel controls.
- **Faceted Category Filtering**: 10 primary categories with live repository counts and horizontal scrolling on mobile.
- **Language Filtering**: Dynamically populated from active repositories with counts and an expandable `+N more` selector.
- **Sorting Options**: Sort by relevance, most stars, recently updated, or alphabetically (A–Z) using a custom accessible listbox styled to match GitHub's dark aesthetic.
- **Deep-Link URL State**: URL search parameters (`q`, `category`, `language`, `sort`) synchronize bidirectionally, making every search and filter view shareable and bookmarkable.
- **Responsive Layout**: Clean desktop grid with mobile-optimized touch controls and zero horizontal overflow across all screen sizes.
- **Full-Card Navigation**: Entire card surfaces are clickable directly to GitHub repositories, complete with GitHub language color indicators and topic badges.

---

## Architecture

```
GitHub API (GET /user/starred)
       │
       ▼
Fetch & Normalization (scripts/fetch.ts)
       │
       ▼
Persistent Cache Seeding (from data/repos.json)
       │
       ▼
Manual Overrides Check (data/overrides.json)
       │
       ▼
Deterministic Rule Classifier (scripts/lib/classifier.ts)
       │
       ├─► Confident match ──► Cached (rule)
       │
       ▼ (if ambiguous or sparse)
Gemini LLM Fallback (gemini-3.8-flash, ~4.8 RPM rate-limited)
       │
       ├─► Successful response ──► Cached (llm)
       └─► Quota limit / 429 / 503 / No key ──► "Other" (fallback, NOT cached)
       │
       ▼
Strict Schema Validation (scripts/validate.ts)
       │
       ▼
data/repos.json (Static Dataset)
       │
       ▼
React 19 + Vite Static Build ──► GitHub Pages
```

### Static Data & Cache Design

- **Zero Client Runtime Overhead**: The frontend never connects to GitHub or Gemini; it consumes the pre-generated `data/repos.json` bundle directly.
- **Persistent Cache Source**: `data/repos.json` is committed to git and acts as the persistent cache seed across ephemeral GitHub Actions runners.
- **Local Cache**: `data/.cache.json` is used during local script runs and is gitignored.
- **Transient Fallbacks**: If Gemini returns a rate-limit (429) or unavailable (503) error, the repository is assigned `category: "Other"` with `method: "fallback"`. Fallback results are **never** persisted to cache, ensuring they remain eligible for re-classification on future pipeline runs.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **UI Framework** | React 19 | Component hierarchy, state, and rendering |
| **Language** | TypeScript 5.7 | Static typing across frontend, pipeline, and tests |
| **Bundler & Dev Server** | Vite 6 | Development server and static production asset bundling |
| **Styling** | Tailwind CSS 3.4 | Utility-first styling with GitHub dark color theme |
| **Search Engine** | Fuse.js 7.1 | In-memory client-side fuzzy search indexing |
| **Icons** | Lucide React | Consistent UI iconography (`Search`, `X`, `ArrowDownUp`, etc.) |
| **Testing** | Vitest 3.0 | Unit and integration test runner for pipeline and UI logic |
| **Pipeline Runner** | tsx | Direct TypeScript execution for Node.js automation scripts |
| **LLM Classification** | Google GenAI SDK (`gemini-3.8-flash`) | Fallback classification for ambiguous repositories |
| **CI/CD & Hosting** | GitHub Actions & GitHub Pages | Scheduled/manual data refreshes and static deployment |

---

## Repository Structure

```
├── .github/workflows/
│   └── refresh.yml            # CI/CD: scheduled refresh, tests, build, and Pages deploy
├── data/
│   ├── repos.json             # Validated production dataset (committed persistent cache)
│   ├── overrides.json         # Manual category overrides (top priority)
│   ├── benchmark.json         # 30-sample development baseline benchmark
│   └── unseen-test.json       # 30-sample unseen generalization evaluation set
├── scripts/
│   ├── run-pipeline.ts        # Master script: fetch -> classify -> validate
│   ├── fetch.ts               # Fetches starred repos via GitHub REST API (100/page)
│   ├── classify.ts            # Hybrid classification runner with cache seeding
│   ├── validate.ts            # Schema and data integrity validator
│   ├── evaluate-classifier.ts # Baseline benchmark evaluation runner
│   ├── evaluate-unseen.ts     # Generalization benchmark evaluation runner
│   └── lib/                   # Normalization, storage, rate limiting, and cache utilities
├── src/
│   ├── components/            # UI components (Header, SearchBar, FilterBar, RepoGrid, RepoCard, etc.)
│   ├── lib/                   # Client search (Fuse.js), sorting, filters, and URL state
│   ├── types/                 # TypeScript interfaces for repos and classification metadata
│   ├── App.tsx                # Main view orchestrator
│   └── index.css              # Global styles, Tailwind directives, and CSS resets
├── tests/                     # 79 unit/integration tests (pipeline, storage, classifier, frontend)
├── package.json               # Scripts and dependency declarations
└── vite.config.ts             # Vite configuration with GitHub Pages base path
```

---

## Classification

Every repository is classified into exactly one primary category from the following allowed vocabulary:

1. `Web Frontend`
2. `Backend / API`
3. `DevOps / Infra`
4. `ML / AI`
5. `Data Engineering`
6. `CLI / Tools`
7. `Learning / Docs`
8. `Mobile`
9. `Security`
10. `Other`

### Classification Order

1. **Manual Overrides**: Entries in `data/overrides.json` take highest precedence (`method: "manual"`, confidence `1.0`).
2. **Persistent Cache Match**: If repository metadata matches a valid non-fallback classification in `data/repos.json` by SHA-256 `inputHash`, the classification is reused.
3. **Deterministic Rules**: Tokenizes repository name, matches normalized topics, checks primary language, and inspects descriptions. If a rule reaches the confidence threshold, it classifies the repository (`method: "rule"`, confidence `0.85`–`0.95`).
4. **Gemini Fallback**: Ambiguous or sparse repositories are passed to Gemini (`method: "llm"`, model `gemini-3.8-flash`).
5. **Safe Fallback**: If the Gemini API is unreachable, unconfigured, or rate-limited, the repository is categorized as `"Other"` with `method: "fallback"` (confidence `0.5`).

---

## Gemini & Rate Limiting

- **Model**: `gemini-3.8-flash` via `@google/genai`.
- **Environment Variable**: `GEMINI_API_KEY` (required only for LLM fallback; rules function without it).
- **Centralized Rate Limiter**: Enforces a minimum interval of **12.5 seconds** between outgoing API requests (~4.8 requests/minute), strictly respecting the Gemini Free Tier limit of 5 requests/minute.
- **Retry & Backoff**: Automatically handles HTTP 429 (Resource Exhausted) and HTTP 503 (Unavailable) responses with bounded retries (up to 3 total attempts per repository), extracting server-provided `retryDelay` headers or applying exponential backoff.
- **Cache Safety**: Because 429 and 503 errors trigger fallback classifications, fallbacks are excluded from cache persistence so future runs can retry cleanly.

---

## Data & Cache

- **Input Hash**: A deterministic 16-character SHA-256 hash computed from `fullName`, `description`, `topics`, and `language`. If any metadata changes upstream, the hash changes, invalidating the cached classification.
- **Manual Overrides**: Pin specific repositories in `data/overrides.json`:
  ```json
  {
    "astral-sh/uv": { "category": "CLI / Tools" },
    "facebook/react": { "category": "Web Frontend" }
  }
  ```
- **Storage Safety**: Dataset writes use atomic staging files and backup copies to ensure that unexpected script crashes or network failures never corrupt `data/repos.json`.

---

## Local Development

### Prerequisites

- **Node.js** (v20+ recommended)
- **npm** (v10+ recommended)

### 1. Setup

```bash
git clone https://github.com/denizyozgatli/starred-repos-classifier.git
cd starred-repos-classifier
npm install
```

### 2. Environment Configuration

Create a local `.env` file:

```bash
cp .env.example .env
```

Populate the variables:
```env
# Required to fetch starred repositories:
GITHUB_TOKEN=ghp_your_personal_access_token

# Optional for Gemini fallback classification:
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Run the Frontend

```bash
npm run dev
```
Open `http://localhost:3000` (or `http://localhost:5173`) in your browser.

---

## NPM Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `vite` | Starts local development server |
| `build` | `tsc && vite build` | Typechecks and builds static assets in `dist/` |
| `preview` | `vite preview` | Serves the local `dist/` production build |
| `test` | `vitest run` | Runs all 79 unit and integration tests |
| `test:watch` | `vitest` | Runs tests in interactive watch mode |
| `pipeline:run` | `tsx scripts/run-pipeline.ts` | Runs the full pipeline: fetch, classify, and validate |
| `pipeline:fetch` | `tsx scripts/fetch.ts` | Fetches starred repositories from GitHub API |
| `pipeline:classify`| `tsx scripts/classify.ts` | Classifies repositories with rules, cache, and Gemini |
| `pipeline:validate`| `tsx scripts/validate.ts` | Validates `data/repos.json` against schema and constraints |
| `evaluate` | `tsx scripts/evaluate-classifier.ts` | Evaluates rule classifier against baseline benchmark (30 samples) |
| `evaluate:unseen` | `tsx scripts/evaluate-unseen.ts` | Evaluates rule classifier against unseen test set (30 samples) |

---

## Testing & Evaluation

### Automated Test Suite

```bash
npm test
```
Executes 79 tests across 3 suites:
- Pipeline fetch, normalization, atomic rollback, and pagination.
- Rate limiter intervals, retry backoff, and cache exclusion rules.
- Deterministic rule classifier tokenization, intent detection, and scoring.
- Client-side Fuse.js fuzzy search, URL state management, and sorting.

### Development Benchmark

```bash
npm run evaluate
```
Evaluates classifier accuracy against `data/benchmark.json` (30 curated samples). Current baseline score: **30/30 (100.0%)**.

### Generalization Benchmark

```bash
npm run evaluate:unseen
```
Evaluates classifier performance against `data/unseen-test.json` (30 independent repositories categorized by confidence level: high, medium, boundary). Current evaluation score: **27/30 (90.0% overall, 17/17 100% on high-confidence samples)**.

---

## GitHub Actions CI/CD

The workflow (`.github/workflows/refresh.yml`) manages data synchronization and deployment:

### Triggers
- **Schedule**: Automatically runs daily at 00:00 UTC (`0 0 * * *`).
- **Manual**: Can be triggered anytime via `workflow_dispatch` in the Actions tab.
- *(Note: Normal code pushes do not auto-run the refresh pipeline to prevent unnecessary API usage; trigger via `workflow_dispatch` after code changes if immediate deployment is needed).*

### Pipeline Steps
1. Runs `npm ci`.
2. Executes `npm run pipeline:run` (fetch, classify with rate limiting, apply overrides, validate).
3. Executes `npm test` and `npm run build`.
4. Checks for differences in `data/repos.json`. If updated, commits changes with message `chore(data): refresh starred repositories dataset [skip ci]` and pushes to `master`.
5. Uploads `dist/` as a Pages artifact and deploys to GitHub Pages (`actions/deploy-pages@v4`).

---

## Required Secrets

Configure these in your GitHub repository under **Settings > Secrets and variables > Actions**:

| Secret Name | Required | Purpose |
|---|---|---|
| `PAT_GITHUB_TOKEN` | Yes | Personal Access Token with permissions to read user stars (mapped to `GITHUB_TOKEN` in the workflow environment; falls back to repository `GITHUB_TOKEN`) |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for fallback LLM classification |

---

## Frontend UI & Controls

- **Search**: Fuzzy search via Fuse.js with real-time feedback, accessible `/` shortcut, and a custom clear button. Native browser search clear buttons are suppressed to avoid duplicate icons.
- **Sort Selector**: Custom accessible combobox/listbox with GitHub dark navy styling (`#161b22`, `#30363d`), checkmark indicators, and full keyboard navigation (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`, `Tab`).
- **Filter Bar**: Horizontally scrollable category pills with live counters, dynamic language chips, and an expandable `+N more` selector.
- **Repository Cards**: Full-card clickable surfaces linking to GitHub, complete with language color dots, star counts, and topic tags.

---

## Deployment

The application is deployed on **GitHub Pages**:
- **Production URL**: [https://denizyozgatli.github.io/starred-repos-classifier/](https://denizyozgatli.github.io/starred-repos-classifier/)
- **Base Path**: `/starred-repos-classifier/` configured in `vite.config.ts`.
- **Deployment Process**: Static assets built from `dist/` are deployed automatically during the daily scheduled run or upon triggering `workflow_dispatch`.

---

## Development Guidelines

- **Isolate Changes**: Keep frontend UI updates separate from data pipeline and classifier changes.
- **Protect Secrets**: Never commit `.env` or hardcode API tokens into repository files.
- **Benchmark Integrity**: Do not alter `data/benchmark.json` or `data/unseen-test.json` to artificially inflate accuracy scores.
- **Cache Invariants**: Never persist fallback classifications (`method: "fallback"`) to the persistent cache.
- **Pre-Commit Verification**: Always run `npm test` and `npm run build` before committing changes.
- **Keep Docs Synchronized**: Update `README.md` whenever operational steps, dependencies, or architectural rules change.

---

## Current Status

The application is fully operational and actively deployed to GitHub Pages. All 79 automated tests pass cleanly, and the production site serves 92 categorized starred repositories with real-time search and filtering.
