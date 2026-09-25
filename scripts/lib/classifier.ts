import { GoogleGenAI } from '@google/genai';
import { ALLOWED_CATEGORIES, type RepositoryCategory } from '../../src/types/repo.ts';
import type { NormalizedRepo } from './normalize.ts';

export interface ClassificationResult {
  category: RepositoryCategory;
  method: 'rule' | 'llm' | 'manual';
  confidence: number;
}

interface RuleDefinition {
  category: RepositoryCategory;
  topicKeywords: string[];
  textKeywords: string[];
  languages?: string[];
  confidence: number;
}

const RULES: RuleDefinition[] = [
  {
    category: 'Mobile',
    topicKeywords: ['android', 'ios', 'flutter', 'react-native', 'mobile', 'swiftui', 'jetpack-compose', 'xcode'],
    textKeywords: ['android app', 'ios app', 'mobile app', 'flutter app', 'react native'],
    languages: ['Swift', 'Kotlin', 'Dart'],
    confidence: 0.95,
  },
  {
    category: 'ML / AI',
    topicKeywords: [
      'machine-learning', 'deep-learning', 'llm', 'artificial-intelligence', 'ai',
      'nlp', 'computer-vision', 'pytorch', 'tensorflow', 'transformers', 'huggingface',
      'generative-ai', 'neural-network', 'langchain', 'llama', 'ollama', 'openai',
      'diffusion', 'reinforcement-learning', 'gemini', 'rag'
    ],
    textKeywords: [
      'large language model', 'machine learning', 'deep learning', 'neural network',
      'generative ai', 'text generation', 'diffusion model', 'computer vision'
    ],
    confidence: 0.96,
  },
  {
    category: 'DevOps / Infra',
    topicKeywords: [
      'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm', 'ci-cd', 'cicd',
      'github-actions', 'devops', 'infrastructure', 'monitoring', 'prometheus',
      'grafana', 'cloud-native', 'containers', 'linux', 'serverless', 'iac'
    ],
    textKeywords: [
      'container', 'kubernetes', 'orchestration', 'infrastructure as code',
      'deployment', 'monitoring tool', 'cluster management'
    ],
    languages: ['HCL'],
    confidence: 0.94,
  },
  {
    category: 'Data Engineering',
    topicKeywords: [
      'data-engineering', 'etl', 'spark', 'kafka', 'flink', 'data-pipeline',
      'duckdb', 'clickhouse', 'bigquery', 'snowflake', 'airflow', 'dbt', 'lakehouse',
      'data-warehouse', 'streaming-data', 'olap'
    ],
    textKeywords: [
      'data pipeline', 'etl pipeline', 'data engineering', 'analytics engine',
      'data processing', 'distributed sql'
    ],
    confidence: 0.94,
  },
  {
    category: 'Security',
    topicKeywords: [
      'security', 'cybersecurity', 'vulnerability', 'cve', 'penetration-testing',
      'pentest', 'exploit', 'cryptography', 'malware', 'reverse-engineering',
      'auth', 'oauth', 'identity', 'firewall', 'secret-management'
    ],
    textKeywords: [
      'security scanner', 'vulnerability scanner', 'penetration testing',
      'cryptographic', 'authentication', 'authorization'
    ],
    confidence: 0.94,
  },
  {
    category: 'Web Frontend',
    topicKeywords: [
      'frontend', 'react', 'vue', 'vuejs', 'svelte', 'angular', 'nextjs', 'astro',
      'tailwind', 'tailwindcss', 'css', 'html', 'ui', 'components', 'design-system',
      'vite', 'webpack', 'web-app', 'dom', 'browser', 'web-components'
    ],
    textKeywords: [
      'user interface', 'frontend framework', 'ui component', 'css framework',
      'react component', 'web application framework'
    ],
    languages: ['Vue', 'Svelte', 'CSS', 'HTML', 'SCSS'],
    confidence: 0.93,
  },
  {
    category: 'Backend / API',
    topicKeywords: [
      'backend', 'api', 'rest-api', 'graphql', 'grpc', 'microservices', 'orm',
      'fastapi', 'express', 'django', 'flask', 'spring-boot', 'nestjs', 'gin',
      'actix', 'database', 'sql', 'postgres', 'redis', 'web-framework'
    ],
    textKeywords: [
      'rest api', 'web api', 'backend service', 'microservice', 'http server',
      'database management', 'database engine'
    ],
    confidence: 0.92,
  },
  {
    category: 'CLI / Tools',
    topicKeywords: [
      'cli', 'command-line', 'terminal', 'tool', 'tools', 'utility', 'utilities',
      'tui', 'shell', 'bash', 'zsh', 'linter', 'formatter', 'git-tool'
    ],
    textKeywords: [
      'command-line', 'cli tool', 'terminal', 'utility for', 'command line interface'
    ],
    languages: ['Shell'],
    confidence: 0.91,
  },
  {
    category: 'Learning / Docs',
    topicKeywords: [
      'awesome', 'awesome-list', 'tutorial', 'learning', 'education', 'roadmap',
      'cheatsheet', 'interview-prep', 'documentation', 'guide', 'study', 'books'
    ],
    textKeywords: [
      'curated list', 'awesome list', 'learning resource', 'educational',
      'roadmap for', 'developer guide', 'study guide'
    ],
    confidence: 0.93,
  },
];

/**
 * Attempts rule-based classification based on topics, language, name, and description.
 * Returns null if no rule strongly matches (leaving it ambiguous).
 */
export function classifyWithRules(repo: NormalizedRepo): ClassificationResult | null {
  const repoTopics = repo.topics.map(t => t.toLowerCase());
  const repoText = `${repo.name} ${repo.description || ''}`.toLowerCase();
  const repoLang = repo.language || '';

  let bestMatch: ClassificationResult | null = null;
  let highestScore = 0;

  for (const rule of RULES) {
    let score = 0;

    // Check language match
    if (rule.languages?.includes(repoLang)) {
      score += 2;
    }

    // Check topic match
    for (const topic of repoTopics) {
      if (rule.topicKeywords.includes(topic)) {
        score += 3;
      }
    }

    // Check keyword text match
    for (const kw of rule.textKeywords) {
      if (repoText.includes(kw)) {
        score += 2;
      }
    }

    // Threshold for confident match
    if (score >= 3 && score > highestScore) {
      highestScore = score;
      bestMatch = {
        category: rule.category,
        method: 'rule',
        confidence: Math.min(rule.confidence + (score > 5 ? 0.03 : 0), 0.99),
      };
    }
  }

  return bestMatch;
}

/**
 * Classifies an ambiguous repository using the Gemini LLM.
 * Falls back to "Other" if no API key is provided or if an error occurs.
 */
export async function classifyWithLLM(
  repo: NormalizedRepo,
  apiKey?: string
): Promise<ClassificationResult> {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      category: 'Other',
      method: 'rule',
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

Rules:
1. Respond with a valid JSON object containing "category" and "confidence" (number between 0.50 and 0.99).
2. "category" MUST be exactly one of the allowed categories listed above. Do not invent any new category.
3. Example JSON response: {"category": "Backend / API", "confidence": 0.88}`;

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
    method: 'rule',
    confidence: 0.5,
  };
}

/**
 * Hybrid classifier:
 * 1. Checks rule-based classification.
 * 2. If ambiguous, falls back to LLM.
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
