// HTTP client for the Keyword Tool guest MCP server
// (https://mcp.keywordtool.io/guest) — a free, no-auth Streamable HTTP MCP
// endpoint. Confirmed live 2026-09-18 (see PLAN-KEYWORDTOOL.md). No
// documented plain REST endpoint exists, only the MCP tool surface, so this
// client speaks MCP directly via the official SDK.
//
// Rate limits: 60 requests/hour, 120/day, most likely enforced per source IP
// by keywordtool.io — not something this app can track authoritatively on
// its own (see lib/keywordtool/quota.ts, which treats `keywordtool-quota-guest`
// as the single source of truth).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { KeywordResult } from "@/lib/keyword-research/types";
import type { KeywordResearchType, KeywordSearchEngine } from "@/lib/keyword-research/types";

const KEYWORDTOOL_MCP_URL = "https://mcp.keywordtool.io/guest";
const CALL_TIMEOUT_MS = 20_000;

export type KeywordToolSuggestionsParams = {
  keyword: string;
  platform: KeywordSearchEngine;
  country: string; // full name, e.g. "Poland" or "Global / Worldwide"
  language: string; // full name, e.g. "Polish"
  type: KeywordResearchType;
  limit?: number;
  exclude?: string[];
  next_page?: string;
};

export type KeywordToolDataRow = {
  string: string;
  metrics_status?: string | null;
  volume?: number | null;
  trend?: number[] | null;
  cmp?: number | null;
  cpc?: number | null;
  top_of_page_bid_low?: number | null;
  top_of_page_bid_high?: number | null;
};

export type KeywordToolSuggestionsResult = {
  data: KeywordToolDataRow[];
  total_count: number | null;
  pagination: unknown;
  notice: string | null;
  rate_limit_reached: boolean;
  quota_resets_at: string | null;
};

export type KeywordToolQuotaBand = {
  used: number;
  remaining: number;
  quota: number;
};

export type KeywordToolQuotaResult = {
  hourly: KeywordToolQuotaBand | null;
  daily: KeywordToolQuotaBand | null;
  timestamp: string | null;
};

class KeywordToolError extends Error {}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(KEYWORDTOOL_MCP_URL));
  const client = new Client({ name: "crawlseo", version: "1.0.0" });

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new KeywordToolError("Keyword Tool MCP call timed out")), CALL_TIMEOUT_MS);
  });

  try {
    await Promise.race([client.connect(transport), timeout]);
    return await Promise.race([fn(client), timeout]);
  } finally {
    await client.close().catch(() => {});
  }
}

// The MCP SDK types `structuredContent` loosely; the guest server also
// sometimes only populates `content[0].text` with the JSON payload instead.
// Read defensively from either.
function extractStructured(result: {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as Record<string, unknown>;
  }
  const textBlock = result.content?.find((c) => c.type === "text" && typeof c.text === "string");
  if (textBlock?.text) {
    try {
      return JSON.parse(textBlock.text) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }
  return {};
}

export async function fetchSuggestions(
  params: KeywordToolSuggestionsParams
): Promise<KeywordToolSuggestionsResult> {
  const { keyword, platform, country, language, type, limit = 50, exclude, next_page } = params;

  const result = await withClient((client) =>
    client.callTool({
      name: "keywordtool-suggestions-guest",
      arguments: {
        keyword,
        platform,
        country,
        language,
        type,
        limit,
        ...(exclude && exclude.length > 0 ? { exclude } : {}),
        ...(next_page ? { next_page } : {}),
      },
    })
  );

  const structured = extractStructured(
    result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }
  );

  return {
    data: Array.isArray(structured.data) ? (structured.data as KeywordToolDataRow[]) : [],
    total_count: typeof structured.total_count === "number" ? structured.total_count : null,
    pagination: structured.pagination ?? null,
    notice: typeof structured.notice === "string" ? structured.notice : null,
    rate_limit_reached: structured.rate_limit_reached === true,
    quota_resets_at:
      typeof structured.quota_resets_at === "string" ? structured.quota_resets_at : null,
  };
}

export async function getQuota(): Promise<KeywordToolQuotaResult> {
  const result = await withClient((client) =>
    client.callTool({ name: "keywordtool-quota-guest", arguments: {} })
  );

  const structured = extractStructured(
    result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }
  );

  function toBand(value: unknown): KeywordToolQuotaBand | null {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    const used = typeof v.used === "number" ? v.used : null;
    const remaining = typeof v.remaining === "number" ? v.remaining : null;
    const quota = typeof v.quota === "number" ? v.quota : null;
    if (used === null || remaining === null || quota === null) return null;
    return { used, remaining, quota };
  }

  return {
    hourly: toBand(structured.hourly),
    daily: toBand(structured.daily),
    timestamp: typeof structured.timestamp === "string" ? structured.timestamp : null,
  };
}

// Maps a Keyword Tool guest MCP row onto the shared KeywordResult shape used
// across all providers. Difficulty is always null — Keyword Tool doesn't
// report it. `cpc` prefers the raw cpc field, falling back to the Google
// top-of-page high bid (the plan's mapping: cpc / top_of_page_bid_high →
// cpc).
export function toKeywordResult(row: KeywordToolDataRow): KeywordResult {
  return {
    keyword: row.string,
    volume: row.volume ?? null,
    difficulty: null,
    cpc: row.cpc ?? row.top_of_page_bid_high ?? null,
    competition: row.cmp ?? null,
    trend: Array.isArray(row.trend) ? row.trend : null,
  };
}
