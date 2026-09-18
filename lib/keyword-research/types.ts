// Shared types for the keyword-research provider abstraction. `KeywordResult`
// originates here and is re-exported from `lib/dataforseo/client.ts` for
// backwards compatibility with existing imports.

export type KeywordResult = {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number[] | null; // monthly search volume trend
};

export type KeywordResearchProvider = "dataforseo" | "keywordtool" | "autocomplete";

export type KeywordSearchEngine = "google" | "bing";

export type KeywordResearchType = "suggestions" | "questions" | "prepositions";

export type KeywordResearchParams = {
  query: string;
  provider: KeywordResearchProvider;
  engine: KeywordSearchEngine;
  country: string;
  language: string;
  type: KeywordResearchType;
};

export type KeywordResearchQuota = {
  hourly: { used: number; remaining: number; quota: number } | null;
  daily: { used: number; remaining: number; quota: number } | null;
  fetchedAt: string;
  blockedUntil: string | null;
};

export type KeywordResearchResponse = {
  source: KeywordResearchProvider;
  keywords: KeywordResult[];
  notice?: string;
  quota?: KeywordResearchQuota;
  cached?: boolean;
};
