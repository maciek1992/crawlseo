import { keywordResearch as dataforseoKeywordResearch } from "@/lib/dataforseo/client";
import { fetchSuggestions as fetchAutocompleteSuggestions } from "@/lib/google/autocomplete";
import { runKeywordToolResearch, cacheKeyFor } from "@/lib/keywordtool/quota";
import { db } from "@/lib/db";
import { getUserSettings } from "@/lib/user-settings";
import { findCountry, findLanguage } from "@/lib/keyword-research/locales";
import type {
  KeywordResearchParams,
  KeywordResearchResponse,
} from "@/lib/keyword-research/types";

export { KeywordToolBlockedError } from "@/lib/keywordtool/quota";

async function readGenericCache(
  cacheKey: string,
  ttlDays: number
): Promise<KeywordResearchResponse | null> {
  const row = await db.keywordResearchCache.findUnique({ where: { cacheKey } });
  if (!row) return null;
  const expiresAt = row.createdAt.getTime() + ttlDays * 24 * 60 * 60 * 1000;
  if (expiresAt <= Date.now()) return null;
  return row.response as unknown as KeywordResearchResponse;
}

async function writeGenericCache(
  cacheKey: string,
  provider: string,
  response: KeywordResearchResponse
): Promise<void> {
  await db.keywordResearchCache.upsert({
    where: { cacheKey },
    create: { cacheKey, provider, response: response as object },
    update: { provider, response: response as object, createdAt: new Date() },
  });
}

/**
 * Runs keyword research for the given provider, dispatching to the right
 * backend. Caching applies to all providers (including DataForSEO, to save
 * money on paid calls) except `keywordtool`, which owns its own cache +
 * quota flow in lib/keywordtool/quota.ts because it also has to coordinate
 * the shared rate limit.
 */
export async function runKeywordResearch(
  userId: string,
  params: KeywordResearchParams
): Promise<KeywordResearchResponse> {
  const country = findCountry(params.country);
  const language = findLanguage(params.language);

  if (params.provider === "keywordtool") {
    return runKeywordToolResearch(userId, params, country.ktCountry, language.ktLanguage);
  }

  const settings = await getUserSettings(userId);
  const cacheKey = cacheKeyFor(params);
  const cached = await readGenericCache(cacheKey, settings.keywordCacheTtlDays);
  if (cached) return { ...cached, cached: true };

  let response: KeywordResearchResponse;

  if (params.provider === "dataforseo") {
    const results = await dataforseoKeywordResearch(
      userId,
      params.query,
      language.dfsCode,
      country.dfsLocation
    );
    if (results === null) {
      // No credentials / call failed — fall back to autocomplete rather
      // than caching an error.
      const suggestions = await fetchAutocompleteSuggestions(params.query, language.hl);
      response = {
        source: "autocomplete",
        keywords: suggestions.map((s) => ({
          keyword: s,
          volume: null,
          difficulty: null,
          cpc: null,
          competition: null,
          trend: null,
        })),
      };
    } else {
      response = { source: "dataforseo", keywords: results };
    }
  } else {
    // autocomplete
    const suggestions = await fetchAutocompleteSuggestions(params.query, language.hl);
    response = {
      source: "autocomplete",
      keywords: suggestions.map((s) => ({
        keyword: s,
        volume: null,
        difficulty: null,
        cpc: null,
        competition: null,
        trend: null,
      })),
    };
  }

  await writeGenericCache(cacheKey, response.source, response);
  return response;
}

export type {
  KeywordResearchParams,
  KeywordResearchResponse,
  KeywordResearchProvider,
  KeywordSearchEngine,
  KeywordResearchType,
} from "@/lib/keyword-research/types";
