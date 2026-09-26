# GitHub Starred Repositories Classifier

A fast, responsive, and minimal personal web catalog that automatically fetches your GitHub starred repositories, classifies them into practical categories using a hybrid deterministic-rule and Gemini LLM pipeline, and serves an instant client-side browser with fuzzy search, faceted filtering, and sorting.

**Live Production Site:** [https://denizyozgatli.github.io/starred-repos-classifier/](https://denizyozgatli.github.io/starred-repos-classifier/)

The application runs entirely as a static frontend with no runtime backend server. All repository metadata and classifications are precomputed at pipeline execution time, validated, and statically bundled.

---

## Features

- **Automated Repository Classification**: Classifies starred repositories using deterministic rules based on language, topics, name, and description, falling back to Gemini for ambiguous metadata.
- **GitHub Star Lists Support**: Fetches user-curated Star Lists via GitHub's GraphQL API. Repositories display GitHub-styled purple list badges and can be filtered by specific lists, seamlessly combining with category and language filters.
- **Fast Client-Side Search (<100ms)**: Real-time fuzzy searching across repository names, owners, descriptions, topics, and languages via Fuse.js.
- **Search Usability**: Accessible `/` keyboard shortcut to focus search, a custom clear button, and suppression of duplicate browser-native search cancel controls.
- **Faceted Category & Star List Filtering**: 10 primary categories and dynamic Star List pills with live repository counts, supporting horizontal scrolling on mobile.
- **Language Filtering**: Dynamically populated from active repositories with counts and an expandable `+N more` selector.
- **Sorting Options**: Sort by relevance, most stars, recently updated, or alphabetically (A–Z) using a custom accessible listbox styled to match GitHub's dark aesthetic.
- **Deep-Link URL State**: URL search parameters (`q`, `category`, `language`, `list`, `sort`) synchronize bidirectionally, making every search and filter view shareable and bookmarkable.
- **Responsive Layout**: Clean desktop grid with mobile-optimized touch controls and zero horizontal overflow across all screen sizes.
- **Full-Card Navigation**: Entire card surfaces are clickable directly to GitHub repositories, complete with GitHub language color indicators and topic badges.

---

## Architecture

```
GitHub API (GET /users/{username}/starred OR GET /user/starred)
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
data/repos.json + data/metadata.json (Static Dataset & Active Identity)
       │
       ▼
React 19 + Vite Static Build ──► GitHub Pages / Static Host
```

### Static Data & Cache Design

- **Zero Client Runtime Overhead**: The frontend never connects to GitHub or Gemini; it consumes the pre-generated `data/repos.json` and `data/metadata.json` bundle directly.
- **Persistent Cache Source**: `data/repos.json` is committed to git and acts as the persistent cache seed across ephemeral GitHub Actions runners.
- **Dataset Identity Metadata**: `data/metadata.json` records the active dataset source and GitHub username (`source: { type: "github-stars", username: "..." }`), decoupling the displayed dataset from permanent project attribution.
- **Local Cache**: `data/.cache.json` is used during local script runs and is gitignored.
- **Transient Fallbacks**: If Gemini returns a rate-limit (429) or unavailable (503) error, the repository is assigned `category: "Other"` with `method: "fallback"`. Fallback results are **never** persisted to cache, ensuring they remain eligible for re-classification on future pipeline runs.
- **GitHub Star Lists (GraphQL)**: Curated star list memberships are fetched via GitHub's GraphQL API when a token (`GITHUB_TOKEN`) is available. If running unauthenticated against public stars, Star Lists retrieval is gracefully skipped (`lists: []`) without breaking the ingestion pipeline.


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
│   ├── metadata.json          # Dataset metadata and active username source
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
├── tests/                     # 84 unit/integration tests (pipeline, storage, classifier, frontend)
├── package.json               # Scripts and dependency declarations
└── vite.config.ts             # Vite configuration with portable base path

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

## Standalone CLI (`star-classifier`)

You can generate a categorized dataset for any GitHub account directly from your terminal and load it into the web dashboard:

```bash
# Fetch and classify any public user's starred repositories:
npx star-classifier --user <github-username>

# Or fetch your own stars (including private Star Lists):
npx star-classifier --token <github-token>
```

### CLI Features & Capabilities

- **Direct Web Import**: Generates `./repos.json` by default (or custom path via `-o my-stars.json`). Simply open the [web dashboard](https://denizyozgatli.github.io/starred-repos-classifier/), click **Import JSON** in the top navigation, and drag-and-drop the file.
- **GitHub Star Lists**: Providing a GitHub token (`--token` or `GITHUB_TOKEN` environment variable) automatically retrieves your curated Star Lists via GitHub's GraphQL API. When running without a token on public users, Star Lists are cleanly omitted (`lists: []`).
- **Deterministic Rules & Gemini**: By default, repositories are classified using fast deterministic rules. Ambiguous repositories can leverage Gemini if you supply a Gemini key (`--gemini-key` or `GEMINI_API_KEY`). You can also force rule-only mode with `--rule-only`.
- **Safe & Isolated**: The CLI runs with an isolated cache (`./.star-classifier-cache.json`) and never mutates repository source data or manual overrides.

### Common Examples

```bash
# Public user stars (fast, rule-based, custom output):
npx star-classifier --user torvalds -o torvalds-repos.json --rule-only

# Authenticated user stars with Star Lists and Gemini fallback:
npx star-classifier --token ghp_yourToken --gemini-key yourGeminiKey

# In local clone development:
npm run cli -- --user octocat
```

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

### 2. Modes of Operation & Environment Configuration

The pipeline supports two ingestion modes:

#### Option A: Public Username Mode (Recommended for exploring any user's stars)
Fetch public stars for any GitHub user without requiring private token scopes:
```bash
# Via CLI flag:
npm run pipeline:run -- --username octocat

# Or via environment variable in .env:
GITHUB_USERNAME=octocat
```
*(Note: Passing `GITHUB_TOKEN` alongside `GITHUB_USERNAME` increases GitHub API rate limits from 60 to 5,000 requests/hour).*

#### Option B: Authenticated User Mode
Fetch starred repositories for the authenticated token owner:
```env
# Required for authenticated user stars:
GITHUB_TOKEN=ghp_your_personal_access_token

# Optional for Gemini fallback classification:
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Identity & Attribution Model

The application strictly separates two distinct identities:
- **Project Attribution (Permanent)**: Created by **Deniz Yozgatlı** with source repository [denizyozgatli/starred-repos-classifier](https://github.com/denizyozgatli/starred-repos-classifier). This attribution is preserved in the application footer across all forks and deployments.
- **Active Dataset Identity (Dynamic)**: Communicates the owner of the currently displayed repository dataset. Recorded in `data/metadata.json` by the pipeline and rendered dynamically in the header (`Starred by @<username>`). Can also be overridden at build time via `VITE_GITHUB_USERNAME`.

### 4. Run the Frontend

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
| `test` | `vitest run` | Runs all 84 unit and integration tests |
| `test:watch` | `vitest` | Runs tests in interactive watch mode |
| `pipeline:run` | `tsx scripts/run-pipeline.ts` | Runs the full pipeline: fetch, classify, and validate |
| `pipeline:fetch` | `tsx scripts/fetch.ts` | Fetches starred repositories from GitHub API |
| `pipeline:classify`| `tsx scripts/classify.ts` | Classifies repositories with rules, cache, and Gemini |
| `pipeline:validate`| `tsx scripts/validate.ts` | Validates `data/repos.json` and `data/metadata.json` |
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
4. Checks for differences in `data/repos.json` and `data/metadata.json`. If updated, commits changes with message `chore(data): refresh starred repositories dataset [skip ci]` and pushes dynamically to the active workflow branch (`${{ github.ref_name }}`).
5. Uploads `dist/` as a Pages artifact and deploys to GitHub Pages (`actions/deploy-pages@v4`).

---

## Secrets & Configuration for Forks / Self-Hosting

Configure these in your GitHub repository under **Settings > Secrets and variables > Actions**:

| Name | Type | Required | Purpose |
|---|---|---|---|
| `GITHUB_USERNAME` | Variable or Secret | Optional | Target public GitHub username to fetch stars for (recommended for forks) |
| `PAT_GITHUB_TOKEN` | Secret | Optional | Personal Access Token with permissions to read authenticated user stars |
| `GEMINI_API_KEY` | Secret | Optional | Google Gemini API key for fallback LLM classification |

*Fork Tip*: If you fork this project, you can simply set the repository variable `GITHUB_USERNAME=<your_github_handle>` to automatically fetch and classify your public stars on schedule without needing to create a Personal Access Token.

---

## Frontend UI & Controls

- **Search**: Fuzzy search via Fuse.js with real-time feedback, accessible `/` shortcut, and a custom clear button. Native browser search clear buttons are suppressed to avoid duplicate icons.
- **Sort Selector**: Custom accessible combobox/listbox with GitHub dark navy styling (`#161b22`, `#30363d`), checkmark indicators, and full keyboard navigation (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`, `Tab`).
- **Filter Bar**: Horizontally scrollable category pills with live counters, dynamic language chips, and an expandable `+N more` selector.
- **Repository Cards**: Full-card clickable surfaces linking to GitHub, complete with language color dots, star counts, and topic tags.

---

## Deployment & Hosting Portability

The application is statically compiled and portable to any hosting environment:

- **GitHub Pages (Canonical Production)**: [https://denizyozgatli.github.io/starred-repos-classifier/](https://denizyozgatli.github.io/starred-repos-classifier/)
- **Dynamic Repository Subpath**: In GitHub Actions CI, `vite.config.ts` automatically infers the base path from `GITHUB_REPOSITORY` (e.g. `/<repo-name>/`), allowing forks to deploy to GitHub Pages without code changes.
- **Root Domain / Custom Domain / Vercel / Netlify / Cloudflare**: Set the environment variable `BASE_PATH=/` (or `BASE_PATH=./`) during build to serve from root or relative paths.
- **Default Fallback**: Defaults to `/starred-repos-classifier/` for backward compatibility.

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

The application is fully operational and actively deployed to GitHub Pages. All 84 automated tests pass cleanly, and the production site serves 92 categorized starred repositories with real-time search, filtering, and dynamic dataset identity.
