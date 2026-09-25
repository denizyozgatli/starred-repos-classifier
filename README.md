# ⭐ GitHub Starred Repos Classifier

A fast, minimal, responsive personal web dashboard that automatically retrieves your GitHub starred repositories, classifies them into practical categories, and enables instantaneous client-side search, multi-faceted filtering, and sorting.

Built with **React**, **Vite**, **TypeScript**, **Tailwind CSS**, and **Fuse.js**. Completely static and backend-free.

---

## 🚀 Key Features

- **Backend-Free Architecture**: The frontend runs 100% statically in the browser, consuming pre-generated JSON data. GitHub tokens and API keys are never exposed to client bundles.
- **Dynamic Pagination**: Fetches all starred repositories regardless of count (100, 500, 1,000, or several thousand) using 100-item pages.
- **Hybrid Classification**:
  - **Rule-Based Classifier**: High-speed, deterministic classification using repository language, topics, name, and description.
  - **LLM Classifier Fallback**: Powered by Gemini API to categorize ambiguous repositories without inventing unapproved categories.
- **Deterministic Incremental Cache**: Uses SHA-256 content hashing (`fullName`, `description`, `topics`, `language`) to prevent redundant LLM invocations and keep builds fast and stable.
- **Manual Overrides**: Declare custom categorizations in `data/overrides.json` that take top precedence and persist across future refreshes.
- **Failure Safety & Data Protection**: A failed network request, expired token, or API rate limit will **never** overwrite or destroy valid existing data.
- **Strict Schema Validation**: Validates all generated entries (types, URLs, timestamps, allowed categories, duplicate ID/names) before publishing.
- **Instant Client-Side Search (<100ms)**: Fuzzy search across names, full paths, descriptions, topics, and languages via Fuse.js.
- **Dynamic Filters**: Categories and languages are dynamically extracted from the dataset with real-time counts. No hardcoded language lists.
- **Bidirectional URL State**: Deep-link and bookmark any filter/search combination (`?q=docker&category=DevOps%20%2F%20Infra&sort=stars`). Back/forward browser buttons work naturally.
- **Automated GitHub Actions**: Daily scheduled cron job or manual trigger to fetch new stars, re-classify, and commit changes only when updates occur.

---

## 📐 Architecture

```
GitHub API (GET /user/starred)
       │
       ▼
Fetch Pipeline (Pagination + Normalization)
       │
       ▼
Rule-Based Classification
       │
       ▼ (if ambiguous)
LLM Classification (Gemini 2.5 Flash)
       │
       ▼
Classification Cache Check (SHA-256 Input Hash)
       │
       ▼
Manual Overrides (data/overrides.json)
       │
       ▼
Schema Validation (scripts/lib/validator.ts)
       │
       ▼
data/repos.json (Static Dataset)
       │
       ▼
React + Vite Frontend (Client-side Fuse.js Search & Filters)
```

---

## 🏷️ Allowed Categories

Every repository is classified into exactly one primary category:

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

---

## 🛠️ Getting Started

### Prerequisites

- **Node.js** (v20+ recommended)
- **npm** (v10+ recommended)

### 1. Installation

```bash
git clone https://github.com/your-username/starred-repos-classifier.git
cd starred-repos-classifier
npm install
```

### 2. Environment Setup

Create a `.env` file from the provided example:

```bash
cp .env.example .env
```

Configure your credentials:
```env
# Required for pipeline fetch:
GITHUB_TOKEN=ghp_your_personal_access_token_here

# Optional: For fallback LLM classification of ambiguous repositories:
GEMINI_API_KEY=your_gemini_api_key_here
```

> **Security Note:** Never commit your `.env` file. The frontend bundle does not use these variables; they are strictly used by local Node.js pipeline scripts and GitHub Actions secrets.

---

## ⚙️ Running the Pipeline

### Full Automated Run (Fetch, Classify, Validate)
```bash
npm run pipeline:run
```

### Individual Steps

1. **Fetch starred repositories:**
   ```bash
   npm run pipeline:fetch
   ```
   *(Saves normalized raw repositories to `data/raw-repos.json`)*

2. **Run classification with cache & overrides:**
   ```bash
   npm run pipeline:classify
   ```
   *(Generates `data/repos.json` and updates `data/.cache.json`)*

3. **Validate dataset schema:**
   ```bash
   npm run pipeline:validate
   ```

---

## ✏️ Manual Overrides

To manually pin or correct the category of any repository, add an entry to `data/overrides.json`:

```json
{
  "astral-sh/uv": {
    "category": "CLI / Tools"
  },
  "facebook/react": {
    "category": "Web Frontend"
  }
}
```

Manual overrides always take precedence over rule and LLM classifications, and are preserved across future refreshes.

---

## 💻 Frontend Development & Build

### Start Development Server
```bash
npm run dev
```
Open `http://localhost:3000` in your browser.

### Run Production Build
```bash
npm run build
```
Generates production-ready, minified static files in `dist/`.

### Run Test Suite
```bash
npm test
```
Executes 36 unit tests covering:
- Normalization & pagination
- Rule-based & LLM classification
- Deterministic cache hashing
- Manual overrides
- Schema & duplicate validation
- Error handling & rate limits
- Client-side search & filtering
- Sorting & URL state synchronization

---

## 🤖 GitHub Actions Setup

The repository includes a ready-to-use GitHub Actions workflow (`.github/workflows/refresh.yml`).

### Required Secrets

Under your GitHub repository settings (**Settings > Secrets and variables > Actions**), add:

- `PAT_GITHUB_TOKEN`: A Personal Access Token (classic or fine-grained) with `read:user` or star read permissions.
- `GEMINI_API_KEY` *(Optional)*: Google Gemini API key for fallback LLM classification.

### Workflow Triggers
- **Scheduled**: Runs automatically every night at 00:00 UTC.
- **Manual**: Can be triggered anytime via the **Run workflow** button in the Actions tab.
- **Smart Change Detection**: Only creates a git commit if `data/repos.json` actually changes.

---

## 🔍 Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `GitHub token is required` | `GITHUB_TOKEN` environment variable is missing | Create a `.env` file or export `GITHUB_TOKEN=...` before running the pipeline. |
| `GitHub API rate limit exceeded` | Unauthenticated requests or hit hourly quota | Ensure a valid GitHub token is provided. Check reset time in error log. |
| `Validation failed: Duplicate repository ID` | Upstream or manual data contains conflicting IDs | Check `data/repos.json` or re-run `npm run pipeline:run` to rebuild fresh. |
| `Invalid category` | Override contains category not in the 10 allowed | Check `data/overrides.json` against the allowed categories list above. |

---

## 📄 License

MIT
