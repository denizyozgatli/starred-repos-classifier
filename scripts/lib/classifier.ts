import { GoogleGenAI } from '@google/genai';
import { ALLOWED_CATEGORIES, type ClassificationMethod, type RepositoryCategory } from '../../src/types/repo.ts';
import type { NormalizedRepo } from './normalize.ts';

export interface ClassificationResult {
  category: RepositoryCategory;
  method: ClassificationMethod;
  confidence: number;
}

export interface RuleDebugInfo {
  category: RepositoryCategory;
  score: number;
  matchedTopics: string[];
  matchedNameSignals: string[];
  matchedTextKeywords: string[];
  matchedLanguage?: string;
}

export interface ClassificationDebugResult {
  bestMatch: ClassificationResult | null;
  highestScore: number;
  scores: Record<RepositoryCategory, RuleDebugInfo>;
  nameTokens: string[];
  normalizedTopics: string[];
  detectedIntent?: string;
  detectedDomain?: string;
}

/**
 * Splits a repository name into individual semantic tokens.
 * Handles hyphens, underscores, dots, slashes, camelCase, PascalCase, and acronyms.
 */
export function tokenizeRepoName(name: string): string[] {
  const cleanName = name.includes('/') ? name.split('/')[1] : name;
  const rawParts = cleanName.split(/[-_./\s]+/);
  const tokens: string[] = [];

  for (const part of rawParts) {
    if (!part) continue;
    const subParts = part
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/\s+/);

    for (const sub of subParts) {
      const lower = sub.toLowerCase().trim();
      if (lower.length > 0) {
        tokens.push(lower);
      }
    }
  }

  return tokens;
}

const TOPIC_CANONICAL_MAP: Record<string, string> = {
  dataengineering: 'data-engineering',
  datascience: 'data-science',
  dataanalysis: 'data-analysis',
  datavisualization: 'data-visualization',
  anomalydetection: 'anomaly-detection',
  goodbyedpi: 'goodbye-dpi',
  speechrecognition: 'speech-recognition',
  speechtotext: 'speech-to-text',
  machinelearning: 'machine-learning',
  deeplearning: 'deep-learning',
  computervision: 'computer-vision',
  naturallanguageprocessing: 'nlp',
  generativeai: 'generative-ai',
  apachespark: 'spark',
  bigdata: 'data-engineering',
  missingdata: 'missing-data',
  developerguide: 'guide',
  studymaterials: 'study',
  firefoxbrowser: 'browser',
  firefoxbased: 'browser',
  workflowautomation: 'workflow-automation',
  cleanerapp: 'cleaner',
};

/**
 * Normalizes equivalent topic forms (e.g. dataengineering -> data-engineering, data_science -> data-science).
 */
export function normalizeTopic(rawTopic: string): string {
  const lower = rawTopic.toLowerCase().trim().replace(/_/g, '-');
  const mapped = TOPIC_CANONICAL_MAP[lower.replace(/-/g, '')];
  if (mapped) return mapped;
  return lower;
}

// ============================================================================
// DOMAIN DEFINITIONS (What technical subject area is this?)
// ============================================================================

export type DomainType = 'ai' | 'data' | 'devops' | 'security' | 'mobile' | 'web';

interface DomainDefinition {
  domain: DomainType;
  topicKeywords: string[];
  textKeywords: string[];
  strongTextKeywords?: string[];
  nameSignals?: string[];
  languages?: string[];
}

const DOMAINS: DomainDefinition[] = [
  {
    domain: 'ai',
    topicKeywords: [
      'machine-learning', 'deep-learning', 'llm', 'artificial-intelligence', 'ai',
      'nlp', 'computer-vision', 'pytorch', 'tensorflow', 'transformers', 'huggingface',
      'generative-ai', 'neural-network', 'langchain', 'llama', 'ollama', 'openai',
      'diffusion', 'reinforcement-learning', 'gemini', 'rag', 'speech-recognition',
      'speech-to-text', 'whisper', 'agent', 'agents', 'faceswap', 'deepfake',
      'zero-shot', 'automl', 'automated-machine-learning', 'scikit-learn', 'chatgpt',
      'claude', 'prompt-engineering', 'translation', 'deepl', 'spacy'
    ],
    textKeywords: [
      'large language model', 'machine learning', 'deep learning', 'neural network',
      'generative ai', 'text generation', 'diffusion model', 'computer vision',
      'speech recognition', 'speech-to-text', 'audio transcription', 'zero-shot',
      'face swap', 'deepfake', 'ai agents', 'rag apps', 'identity-preserving generation',
      'prompt engineering', 'subtitles translation', 'nlp'
    ],
    strongTextKeywords: [
      'speech recognition', 'audio transcription', 'zero-shot identity-preserving',
      'deep learning model', 'machine learning model', 'imbalanced datasets in machine learning',
      'algorithm powering the for you feed'
    ],
    nameSignals: ['whisper', 'deepfake', 'faceswap', 'instantid', 'llm', 'gpt', 'automl', 'scikit-learn', 'imbalanced-learn', 'rag'],
  },
  {
    domain: 'data',
    topicKeywords: [
      'data-engineering', 'etl', 'spark', 'kafka', 'flink', 'data-pipeline',
      'duckdb', 'clickhouse', 'bigquery', 'snowflake', 'airflow', 'dbt', 'lakehouse',
      'data-warehouse', 'streaming-data', 'olap', 'data-science', 'data-analysis',
      'data-visualization', 'anomaly-detection', 'missing-data', 'pandas', 'numpy',
      'data-mining', 'time-series', 'big-data', 'hadoop', 'data-profiling', 'data-quality'
    ],
    textKeywords: [
      'data pipeline', 'etl pipeline', 'data engineering', 'analytics engine',
      'data processing', 'distributed sql', 'data science', 'data analysis',
      'data visualization', 'anomaly detection', 'time series', 'data profiling',
      'missing data'
    ],
    strongTextKeywords: [
      'data engineering', 'etl pipeline', 'anomaly detection', 'data visualization module',
      'data quality profiling', 'exploratory data analysis for pandas and spark'
    ],
    nameSignals: ['data-engineering', 'data-engineer', 'data-science', 'missingno', 'luminol'],
  },
  {
    domain: 'devops',
    topicKeywords: [
      'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm', 'ci-cd', 'cicd',
      'github-actions', 'devops', 'infrastructure', 'monitoring', 'prometheus',
      'grafana', 'cloud-native', 'containers', 'linux', 'serverless', 'iac',
      'workflow-automation', 'workflow', 'ipaas', 'self-hosted', 'integration-framework'
    ],
    textKeywords: [
      'container', 'kubernetes', 'orchestration', 'infrastructure as code',
      'deployment', 'monitoring tool', 'cluster management', 'workflow automation platform'
    ],
    strongTextKeywords: ['infrastructure as code', 'kubernetes operator', 'workflow automation platform'],
    nameSignals: ['devops', 'k8s', 'docker', 'terraform', 'n8n', 'workflow'],
    languages: ['HCL'],
  },
  {
    domain: 'security',
    topicKeywords: [
      'security', 'cybersecurity', 'vulnerability', 'cve', 'penetration-testing',
      'pentest', 'exploit', 'cryptography', 'malware', 'reverse-engineering',
      'auth', 'oauth', 'identity', 'firewall', 'secret-management', 'osint',
      'reconnaissance', 'dpi', 'goodbye-dpi', 'dnscrypt', 'censorship',
      'anti-censorship', 'bypass', 'security-audit', 'information-gathering',
      'open-source-intelligence', 'anti-surveillance', 'sandbox'
    ],
    textKeywords: [
      'security scanner', 'vulnerability scanner', 'penetration testing',
      'cryptographic', 'authentication', 'authorization', 'information gathering',
      'open-source intelligence', 'osint', 'deep packet inspection', 'anti-censorship',
      'dns bypass', 'circumvention', 'goodbyedpi', 'anonymized dnscrypt'
    ],
    strongTextKeywords: [
      'deep packet inspection', 'open-source intelligence', 'information gathering framework',
      'anti-censorship', 'goodbyedpi', 'anonymized dnscrypt'
    ],
    nameSignals: ['goodbyedpi', 'phoneinfoga', 'osint', 'dpi', 'dnsveil', 'dnscrypt'],
  },
  {
    domain: 'mobile',
    topicKeywords: [
      'android', 'ios', 'flutter', 'react-native', 'mobile', 'swiftui',
      'jetpack-compose', 'xcode', 'kotlin-multiplatform', 'cleaner'
    ],
    textKeywords: ['android app', 'ios app', 'mobile app', 'flutter app', 'react native'],
    strongTextKeywords: ['android application', 'ios application', 'android\'s most thorough cleaning tool'],
    nameSignals: ['android', 'ios', 'flutter', 'swiftui', 'sdmaid'],
    languages: ['Swift', 'Kotlin', 'Dart'],
  },
  {
    domain: 'web',
    topicKeywords: [
      'frontend', 'react', 'vue', 'vuejs', 'svelte', 'angular', 'nextjs', 'astro',
      'tailwind', 'tailwindcss', 'css', 'html', 'ui', 'components', 'design-system',
      'vite', 'webpack', 'web-app', 'dom', 'browser', 'web-components', 'visualization',
      'dashboard', 'browser-extension'
    ],
    textKeywords: [
      'user interface', 'frontend framework', 'ui component', 'css framework',
      'react component', 'web application framework', 'web app', 'web application',
      'web ui', 'web interface', 'interactive visualization'
    ],
    strongTextKeywords: ['frontend framework', 'react component library', 'ui component library', 'interactive visualization of'],
    nameSignals: ['frontend', 'web-ui', 'react-app', 'visualizer', 'dashboard'],
    languages: ['Vue', 'Svelte', 'CSS', 'HTML', 'SCSS'],
  },
];

// ============================================================================
// INTENT DEFINITIONS (What artifact format / functional purpose is this?)
// ============================================================================

export type IntentType =
  | 'educational'
  | 'tool'
  | 'web_app'
  | 'backend'
  | 'orchestration'
  | 'core_model'
  | 'data_pipeline'
  | 'security_tool'
  | 'mobile_app';

interface IntentDefinition {
  intent: IntentType;
  nameSignals: string[];
  topicKeywords: string[];
  strongTextKeywords: string[];
  textKeywords: string[];
}

const INTENTS: IntentDefinition[] = [
  {
    intent: 'educational',
    nameSignals: [
      'handbook', 'cheatsheet', 'roadmap', 'curriculum', 'course', 'courses',
      'tutorial', 'tutorials', 'bootcamp', '100-days', 'beginners', 'for-beginners',
      'howto', 'how-to', 'notes', 'awesome', 'guide', 'tips', 'study', 'lessons',
      'notebook', 'notebooks'
    ],
    topicKeywords: [
      'tutorial', 'tutorials', 'learning', 'education', 'educational', 'roadmap',
      'cheatsheet', 'cheat-sheet', 'curriculum', 'handbook', 'course', 'courses',
      'for-beginners', 'beginner-project', '100-days', 'awesome', 'awesome-list',
      'interview-prep', 'tips-and-tricks', 'guide', 'study', 'books', 'exercises',
      'notebook', 'notebooks'
    ],
    strongTextKeywords: [
      'in-depth tutorials', 'curated list', 'awesome list', 'open-source curriculum',
      'for beginners', '100 days', 'handbook: full text', '100天', 'lessons',
      'tips for', 'useful resources to learn', 'tips for getting the most',
      'interactive roadmaps', 'data science for all', 'freely available programming books'
    ],
    textKeywords: [
      'tutorial', 'tutorials', 'course', 'curriculum', 'handbook', 'learning resource',
      'educational', 'study guide', 'cheatsheet', 'reference list', 'resource list'
    ],
  },
  {
    intent: 'tool',
    nameSignals: [
      'winutil', 'util', 'utility', 'downloader', 'converter', 'debloat',
      'debloater', 'installer', 'gui', 'launcher', 'cli', 'tool', 'tools',
      'browser', 'cleaner'
    ],
    topicKeywords: [
      'cli', 'command-line', 'terminal', 'tool', 'tools', 'utility', 'utilities',
      'downloader', 'converter', 'debloat', 'tweaks', 'launcher', 'cleaner',
      'desktop-app', 'desktop-application', 'browser'
    ],
    strongTextKeywords: [
      'command line interface', 'system utility', 'desktop application for downloading',
      'tool for converting', 'script that allows you to remove', 'terminal', 'powershell script',
      'brings the power of gemini directly into your terminal', 'graphical interface'
    ],
    textKeywords: [
      'command-line', 'cli tool', 'utility for', 'install programs', 'tweaks',
      'downloader', 'desktop application', 'powershell', 'converter'
    ],
  },
  {
    intent: 'web_app',
    nameSignals: ['visualizer', 'dashboard', 'frontend', 'web-ui', 'webapp', 'multitv'],
    topicKeywords: ['web-app', 'frontend', 'ui', 'components', 'visualization', 'visualizer', 'dashboard', 'browser-extension', 'interface'],
    strongTextKeywords: ['interactive visualization', 'interactive web', 'web application', 'user interface'],
    textKeywords: ['frontend', 'web ui', 'web application', 'ui component', 'visualization'],
  },
  {
    intent: 'backend',
    nameSignals: ['sdk', 'api-client', 'api-wrapper', 'microservice', 'scraper'],
    topicKeywords: [
      'api', 'rest-api', 'graphql', 'grpc', 'api-client', 'api-wrapper', 'sdk',
      'microservices', 'twitter-api', 'x-api', 'twitter-client', 'twitter-scraper', 'wrapper'
    ],
    strongTextKeywords: ['rest api client', 'api wrapper', 'api scraper', 'twitter api scraper'],
    textKeywords: ['rest api', 'web api', 'backend service', 'api client', 'http server', 'api wrapper'],
  },
  {
    intent: 'orchestration',
    nameSignals: ['n8n', 'workflow', 'orchestrator'],
    topicKeywords: ['workflow-automation', 'workflow', 'ipaas', 'self-hosted', 'integration-framework', 'orchestration'],
    strongTextKeywords: ['workflow automation platform', 'fair-code workflow automation', 'integration platform'],
    textKeywords: ['workflow automation', 'automation platform', 'orchestration'],
  },
  {
    intent: 'core_model',
    nameSignals: ['whisper', 'deepfake', 'faceswap', 'instantid', 'llm', 'gpt', 'automl', 'scikit-learn', 'imbalanced-learn', 'from-scratch', 'algorithm'],
    topicKeywords: ['inference', 'speech-recognition', 'automl', 'from-scratch'],
    strongTextKeywords: [
      'speech recognition', 'audio transcription', 'zero-shot identity-preserving',
      'deep learning model', 'machine learning model', 'from scratch', 'algorithm powering the for you feed',
      'face swap and one-click video deepfake', 'real-time deepfake', 'game theoretic approach to explain the output',
      'imbalanced datasets in machine learning', 'implement a chatgpt-like llm in pytorch from scratch'
    ],
    textKeywords: ['machine learning model', 'from scratch', 'algorithm powering'],
  },
  {
    intent: 'data_pipeline',
    nameSignals: ['missingno', 'luminol', 'data-engineer', 'data-engineering', 'pipeline', 'etl'],
    topicKeywords: ['data-engineering', 'etl', 'data-pipeline', 'data-profiling', 'data-quality', 'anomaly-detection', 'missing-data'],
    strongTextKeywords: [
      'data engineering', 'etl pipeline', 'anomaly detection', 'data visualization module',
      'data quality profiling', 'exploratory data analysis for pandas and spark'
    ],
    textKeywords: ['data pipeline', 'etl pipeline', 'data engineering', 'anomaly detection', 'data profiling', 'missing data'],
  },
  {
    intent: 'security_tool',
    nameSignals: ['goodbyedpi', 'goodbye-dpi', 'phoneinfoga', 'osint', 'dpi', 'dnsveil', 'dnscrypt'],
    topicKeywords: ['security', 'cybersecurity', 'osint', 'reconnaissance', 'pentest', 'vulnerability', 'anti-censorship', 'dpi', 'goodbye-dpi', 'dnscrypt', 'anti-surveillance', 'sandbox'],
    strongTextKeywords: [
      'deep packet inspection', 'open-source intelligence', 'information gathering framework',
      'anti-censorship', 'goodbyedpi', 'anonymized dnscrypt'
    ],
    textKeywords: ['security scanner', 'penetration testing', 'information gathering', 'anti-censorship', 'dns bypass'],
  },
  {
    intent: 'mobile_app',
    nameSignals: ['android', 'ios', 'sdmaid'],
    topicKeywords: ['android', 'ios', 'cleaner', 'sdmaid'],
    strongTextKeywords: ['android application', 'android\'s most thorough cleaning tool'],
    textKeywords: ['android app', 'ios app', 'mobile app'],
  },
];

// ============================================================================
// TOPIC SATURATION & SCORING HELPERS
// ============================================================================

/**
 * Calculates domain scores with topic saturation to prevent correlated clusters from dominating.
 * First matching domain topic: +3, Second: +2, Third: +1, Fourth and later: +0 (Max topic contribution = 6).
 */
export function scoreDomainsWithSaturation(
  normalizedTopics: string[],
  nameTokens: string[],
  repoText: string,
  repoLang: string
): Record<DomainType, { score: number; matchedTopics: string[]; matchedName: string[]; matchedText: string[] }> {
  const domainScores: Record<DomainType, { score: number; matchedTopics: string[]; matchedName: string[]; matchedText: string[] }> = {
    ai: { score: 0, matchedTopics: [], matchedName: [], matchedText: [] },
    data: { score: 0, matchedTopics: [], matchedName: [], matchedText: [] },
    devops: { score: 0, matchedTopics: [], matchedName: [], matchedText: [] },
    security: { score: 0, matchedTopics: [], matchedName: [], matchedText: [] },
    mobile: { score: 0, matchedTopics: [], matchedName: [], matchedText: [] },
    web: { score: 0, matchedTopics: [], matchedName: [], matchedText: [] },
  };

  for (const def of DOMAINS) {
    const entry = domainScores[def.domain];

    // Language match (+2)
    if (def.languages?.includes(repoLang)) {
      entry.score += 2;
    }

    // Bounded topic accumulation: 3, 2, 1, 0 (Max = 6)
    let domainTopicCount = 0;
    for (const topic of normalizedTopics) {
      if (def.topicKeywords.includes(topic)) {
        entry.matchedTopics.push(topic);
        domainTopicCount++;
        if (domainTopicCount === 1) entry.score += 3;
        else if (domainTopicCount === 2) entry.score += 2;
        else if (domainTopicCount === 3) entry.score += 1;
        // 4th and beyond: +0 (Saturated)
      }
    }

    // Name signals (+3)
    for (const token of nameTokens) {
      if (def.nameSignals?.includes(token)) {
        entry.matchedName.push(token);
        entry.score += 3;
      }
    }

    // Strong text keywords (+3)
    for (const kw of def.strongTextKeywords || []) {
      if (repoText.includes(kw)) {
        entry.matchedText.push(`strong:${kw}`);
        entry.score += 3;
      }
    }

    // Standard text keywords (+2)
    for (const kw of def.textKeywords) {
      if (repoText.includes(kw) && !entry.matchedText.some(t => t.includes(kw))) {
        entry.matchedText.push(kw);
        entry.score += 2;
      }
    }
  }

  return domainScores;
}

/**
 * Calculates intent (primary structural purpose) scores.
 */
export function scoreIntents(
  nameTokens: string[],
  normalizedTopics: string[],
  repoNameLower: string,
  repoText: string,
  repoDesc: string,
  repoLang: string
): Record<IntentType, { score: number; matched: string[] }> {
  const intentScores: Record<IntentType, { score: number; matched: string[] }> = {
    educational: { score: 0, matched: [] },
    tool: { score: 0, matched: [] },
    web_app: { score: 0, matched: [] },
    backend: { score: 0, matched: [] },
    orchestration: { score: 0, matched: [] },
    core_model: { score: 0, matched: [] },
    data_pipeline: { score: 0, matched: [] },
    security_tool: { score: 0, matched: [] },
    mobile_app: { score: 0, matched: [] },
  };

  // Special heuristic: awesome-* lists or prompt directories
  const isCuratedList = repoDesc.includes('curated list') || repoDesc.includes('prompt library') || repoDesc.includes('system prompts') || normalizedTopics.includes('awesome-list');
  if (isCuratedList || (repoNameLower.startsWith('awesome-') && (repoDesc.includes('curated') || repoDesc.includes('collection') || repoDesc.includes('directory') || repoDesc.includes('frameworks, libraries')))) {
    intentScores.educational.score += 5;
    intentScores.educational.matched.push('awesome-curated-resource');
  }

  // Multilingual or curriculum patterns
  if (repoText.includes('100天') || (nameTokens.includes('100') && nameTokens.includes('days'))) {
    intentScores.educational.score += 6;
    intentScores.educational.matched.push('100-days');
  }

  // Shell / PowerShell language is a strong tool signal
  if (['Shell', 'PowerShell'].includes(repoLang)) {
    intentScores.tool.score += 3;
    intentScores.tool.matched.push(`lang:${repoLang}`);
  }

  for (const def of INTENTS) {
    const entry = intentScores[def.intent];

    // Name tokens (authoritative format: +5 to +6)
    for (const token of nameTokens) {
      if (def.nameSignals.includes(token)) {
        if (token === 'awesome' && (nameTokens.includes('apps') || nameTokens.includes('tools'))) {
          // If named awesome-*-apps or awesome-*-tools, it is an application or tool collection, not an educational guide
          continue;
        }
        entry.score += 5;
        entry.matched.push(`name:${token}`);
      }
    }

    // Compound name checks (e.g. data-engineer, for-beginners, from-scratch)
    for (const signal of def.nameSignals) {
      if (signal.includes('-') && repoNameLower.includes(signal)) {
        if (!entry.matched.some(m => m.includes(signal))) {
          entry.score += 5;
          entry.matched.push(`slug:${signal}`);
        }
      }
    }

    // Topics matching intent (+4)
    for (const topic of normalizedTopics) {
      if (def.topicKeywords.includes(topic)) {
        entry.score += 4;
        entry.matched.push(`topic:${topic}`);
      } else if (def.intent === 'educational' && (topic.includes('beginners') || topic.includes('tutorial') || topic.includes('cheatsheet') || topic.includes('curriculum') || topic.includes('roadmap'))) {
        entry.score += 4;
        entry.matched.push(`edu-topic:${topic}`);
      }
    }

    // Strong text phrases (+4)
    for (const kw of def.strongTextKeywords) {
      if (repoText.includes(kw)) {
        entry.score += 4;
        entry.matched.push(`text-strong:${kw}`);
      }
    }

    // Standard text keywords (+2)
    for (const kw of def.textKeywords) {
      if (repoText.includes(kw) && !entry.matched.some(m => m.includes(kw))) {
        entry.score += 2;
        entry.matched.push(`text:${kw}`);
      }
    }
  }

  return intentScores;
}

// ============================================================================
// CATEGORY PRECEDENCE & RESOLUTION ENGINE
// ============================================================================

/**
 * Resolves final category by evaluating structural intent against technical domain.
 * Intent (Artifact format / primary purpose) takes precedence over raw domain tags.
 */
function resolveCategory(
  intentScores: Record<IntentType, { score: number; matched: string[] }>,
  domainScores: Record<DomainType, { score: number; matchedTopics: string[]; matchedName: string[]; matchedText: string[] }>,
  _repoName?: string,
  _description?: string
): { category: RepositoryCategory; confidence: number; reason: string } | null {
  const edu = intentScores.educational.score;
  const tool = intentScores.tool.score;
  const webApp = intentScores.web_app.score;
  const backend = intentScores.backend.score;
  const orch = intentScores.orchestration.score;
  const coreModel = intentScores.core_model.score;
  const dataPipe = intentScores.data_pipeline.score;
  const secTool = intentScores.security_tool.score;
  const mobApp = intentScores.mobile_app.score;

  const aiDom = domainScores.ai.score;
  const dataDom = domainScores.data.score;
  const devopsDom = domainScores.devops.score;
  const secDom = domainScores.security.score;
  const mobDom = domainScores.mobile.score;

  // 1. Specialized OS/Platform Sandboxes (Mobile & Security)
  if (mobApp >= 4 || (mobDom >= 4 && (mobApp > 0 || tool > 0))) {
    return { category: 'Mobile', confidence: 0.95, reason: 'Mobile platform application/sandbox' };
  }
  if (secTool >= 4 || secDom >= 4) {
    return { category: 'Security', confidence: 0.95, reason: 'Security/OSINT/anti-censorship utility' };
  }

  // 2. Interactive Web Frontend Visualizer / UI Application (e.g. microgpt-visualizer)
  if (webApp >= 4 && webApp > backend) {
    return { category: 'Web Frontend', confidence: 0.94, reason: 'Interactive web frontend, visualizer, or UI' };
  }

  // 3. Workflow Orchestration / Infrastructure Platform (e.g. n8n)
  if (orch >= 4 || (devopsDom >= 4 && orch > 0)) {
    return { category: 'DevOps / Infra', confidence: 0.94, reason: 'Workflow orchestration, self-hosted platform, or DevOps' };
  }

  // 4. Data Engineering / Data Pipeline / Data Quality Profiling (e.g. fg-data-profiling, missingno)
  if (dataPipe >= 4 && dataPipe >= edu) {
    return { category: 'Data Engineering', confidence: 0.94, reason: 'Data processing, analytics pipeline, or data profiling' };
  }

  // 5. Educational Intent Priority (e.g. tutorials, courses, guides, handbooks, how-tos)
  if (edu >= 4 && edu > coreModel) {
    return { category: 'Learning / Docs', confidence: 0.95, reason: 'Educational tutorial, course, handbook, or curated guide' };
  }

  // 6. Core model implementation / algorithm (e.g. whisper, InstantID, LLMs-from-scratch, ML-From-Scratch)
  if (coreModel >= 4) {
    return { category: 'ML / AI', confidence: 0.96, reason: 'Core model, neural network, or algorithm implementation' };
  }

  // 7. Executable CLI Tool / Desktop Utility Priority (e.g. markitdown, gemini-cli, winutil, debloat)
  if (tool >= 4 && tool > backend) {
    return { category: 'CLI / Tools', confidence: 0.93, reason: 'Executable CLI, script, or desktop tool' };
  }

  // 8. Backend / API Client / Service (e.g. twikit)
  if (backend >= 4) {
    return { category: 'Backend / API', confidence: 0.92, reason: 'API client, SDK, or backend service wrapper' };
  }

  // 9. Domain fallback if Domain is strong (score >= 4)
  if (aiDom >= 4) {
    return { category: 'ML / AI', confidence: 0.94, reason: 'Machine learning or generative AI repository' };
  }
  if (dataDom >= 4) {
    return { category: 'Data Engineering', confidence: 0.94, reason: 'Data domain signal match' };
  }
  if (devopsDom >= 4) {
    return { category: 'DevOps / Infra', confidence: 0.94, reason: 'DevOps signal match' };
  }

  // 10. Secondary threshold matches (score >= 3)
  if (edu >= 3) return { category: 'Learning / Docs', confidence: 0.90, reason: 'Learning / Docs signal match' };
  if (tool >= 3) return { category: 'CLI / Tools', confidence: 0.90, reason: 'Tool signal match' };
  if (webApp >= 3) return { category: 'Web Frontend', confidence: 0.90, reason: 'Web frontend signal match' };
  if (backend >= 3) return { category: 'Backend / API', confidence: 0.90, reason: 'Backend signal match' };
  if (aiDom >= 3) return { category: 'ML / AI', confidence: 0.90, reason: 'AI domain signal match' };
  if (dataDom >= 3) return { category: 'Data Engineering', confidence: 0.90, reason: 'Data domain signal match' };
  if (devopsDom >= 3) return { category: 'DevOps / Infra', confidence: 0.90, reason: 'DevOps signal match' };

  return null;
}

// ============================================================================
// MAIN EXPORTS
// ============================================================================

/**
 * Detailed rule-based classification evaluation with score transparency.
 */
export function classifyWithRulesDebug(repo: NormalizedRepo): ClassificationDebugResult {
  const nameTokens = tokenizeRepoName(repo.name);
  const normalizedTopics = repo.topics.map(normalizeTopic);
  const repoNameLower = repo.name.toLowerCase();
  const repoDesc = (repo.description || '').toLowerCase();
  const repoText = `${repoNameLower} ${repoDesc}`;
  const repoLang = repo.language || '';

  const domainScores = scoreDomainsWithSaturation(normalizedTopics, nameTokens, repoText, repoLang);
  const intentScores = scoreIntents(nameTokens, normalizedTopics, repoNameLower, repoText, repoDesc, repoLang);

  const resolved = resolveCategory(intentScores, domainScores, repo.name, repoDesc);

  // Build traditional debug structure for backwards compatibility
  const scores: Record<RepositoryCategory, RuleDebugInfo> = {} as any;
  for (const cat of ALLOWED_CATEGORIES) {
    scores[cat] = {
      category: cat,
      score: 0,
      matchedTopics: [],
      matchedNameSignals: [],
      matchedTextKeywords: [],
    };
  }

  scores['ML / AI'].score = domainScores.ai.score;
  scores['ML / AI'].matchedTopics = domainScores.ai.matchedTopics;
  scores['ML / AI'].matchedNameSignals = domainScores.ai.matchedName;
  scores['ML / AI'].matchedTextKeywords = domainScores.ai.matchedText;

  scores['Data Engineering'].score = domainScores.data.score;
  scores['Data Engineering'].matchedTopics = domainScores.data.matchedTopics;
  scores['Data Engineering'].matchedNameSignals = domainScores.data.matchedName;
  scores['Data Engineering'].matchedTextKeywords = domainScores.data.matchedText;

  scores['DevOps / Infra'].score = domainScores.devops.score;
  scores['DevOps / Infra'].matchedTopics = domainScores.devops.matchedTopics;
  scores['DevOps / Infra'].matchedNameSignals = domainScores.devops.matchedName;
  scores['DevOps / Infra'].matchedTextKeywords = domainScores.devops.matchedText;

  scores['Security'].score = domainScores.security.score;
  scores['Security'].matchedTopics = domainScores.security.matchedTopics;
  scores['Security'].matchedNameSignals = domainScores.security.matchedName;
  scores['Security'].matchedTextKeywords = domainScores.security.matchedText;

  scores['Mobile'].score = domainScores.mobile.score;
  scores['Mobile'].matchedTopics = domainScores.mobile.matchedTopics;
  scores['Mobile'].matchedNameSignals = domainScores.mobile.matchedName;
  scores['Mobile'].matchedTextKeywords = domainScores.mobile.matchedText;

  scores['Learning / Docs'].score = intentScores.educational.score;
  scores['Learning / Docs'].matchedNameSignals = intentScores.educational.matched;

  scores['CLI / Tools'].score = intentScores.tool.score;
  scores['CLI / Tools'].matchedNameSignals = intentScores.tool.matched;

  scores['Web Frontend'].score = intentScores.web_app.score;
  scores['Web Frontend'].matchedNameSignals = intentScores.web_app.matched;

  scores['Backend / API'].score = intentScores.backend.score;
  scores['Backend / API'].matchedNameSignals = intentScores.backend.matched;

  let bestMatch: ClassificationResult | null = null;
  let highestScore = 0;

  if (resolved) {
    bestMatch = {
      category: resolved.category,
      method: 'rule',
      confidence: resolved.confidence,
    };
    highestScore = scores[resolved.category]?.score || 5;
  }

  return {
    bestMatch,
    highestScore,
    scores,
    nameTokens,
    normalizedTopics,
  };
}

/**
 * Attempts rule-based classification based on structural intent and technical domain.
 * Returns null if no rule confidently matches (leaving it for Tier 2 LLM fallback).
 */
export function classifyWithRules(repo: NormalizedRepo): ClassificationResult | null {
  const { bestMatch } = classifyWithRulesDebug(repo);
  return bestMatch;
}

/**
 * Classifies an ambiguous repository using the Gemini LLM.
 * Falls back to "Other" with method: 'fallback' if no API key is provided or if an error occurs.
 */
export async function classifyWithLLM(
  repo: NormalizedRepo,
  apiKey?: string
): Promise<ClassificationResult> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      category: 'Other',
      method: 'fallback',
      confidence: 0.5,
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const prompt = `You are an expert software classifier. Categorize this GitHub repository into EXACTLY ONE of the following allowed categories:
${ALLOWED_CATEGORIES.map(c => `- "${c}"`).join('\n')}

Repository Details:
- Full Name: ${repo.fullName}
- Description: ${repo.description || 'None'}
- Primary Language: ${repo.language || 'Unknown'}
- Topics: ${repo.topics.join(', ') || 'None'}

Classification Rules:
1. Classify the repository based on its PRIMARY PURPOSE and ARTIFACT FORMAT, not merely its technical domain.
2. Note that "AI-related" does NOT automatically mean "ML / AI":
   - An educational tutorial, course, handbook, or list about AI is "Learning / Docs".
   - A developer tool, CLI utility, or converter utilizing AI is "CLI / Tools".
   - An interactive web application, UI, or visualizer is "Web Frontend".
   - An orchestration or workflow automation platform is "DevOps / Infra".
   - An API client or SDK wrapper is "Backend / API".
   - Only code that implements, trains, fine-tunes, or executes actual models/neural architectures is "ML / AI".
3. Respond with a valid JSON object containing "category" and "confidence" (number between 0.50 and 0.99).
4. Example JSON response: {"category": "Learning / Docs", "confidence": 0.88}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '';
    const parsed = JSON.parse(text);

    if (parsed.category && ALLOWED_CATEGORIES.includes(parsed.category as RepositoryCategory)) {
      return {
        category: parsed.category as RepositoryCategory,
        method: 'llm',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
      };
    }
  } catch (error) {
    console.warn(`[classifier] LLM classification failed for ${repo.fullName}:`, error);
  }

  return {
    category: 'Other',
    method: 'fallback',
    confidence: 0.5,
  };
}

/**
 * Hybrid classifier:
 * 1. Checks rule-based classification using Intent & Domain resolution.
 * 2. If ambiguous/sparse, falls back to LLM.
 */
export async function classifyRepo(
  repo: NormalizedRepo,
  geminiApiKey?: string
): Promise<ClassificationResult> {
  const ruleResult = classifyWithRules(repo);
  if (ruleResult) {
    return ruleResult;
  }
  return classifyWithLLM(repo, geminiApiKey);
}
