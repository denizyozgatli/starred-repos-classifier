export type RepositoryCategory =
  | "Web Frontend"
  | "Backend / API"
  | "DevOps / Infra"
  | "ML / AI"
  | "Data Engineering"
  | "CLI / Tools"
  | "Learning / Docs"
  | "Mobile"
  | "Security"
  | "Other";

export const ALLOWED_CATEGORIES: readonly RepositoryCategory[] = [
  "Web Frontend",
  "Backend / API",
  "DevOps / Infra",
  "ML / AI",
  "Data Engineering",
  "CLI / Tools",
  "Learning / Docs",
  "Mobile",
  "Security",
  "Other",
] as const;

export interface ClassificationMeta {
  method: "rule" | "llm" | "manual";
  confidence: number | null;
  classifiedAt: string;
  inputHash: string;
}

export interface Repository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  url: string;
  updatedAt: string;
  category: RepositoryCategory;
  classification: ClassificationMeta;
  archived?: boolean;
  fork?: boolean;
}

export type ManualOverrides = Record<string, { category: RepositoryCategory }>;
