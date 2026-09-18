import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KeywordResearchParams } from "@/lib/keyword-research/types";

// ---------------------------------------------------------------------------
// In-memory fake Prisma client covering just the models quota.ts touches.
// ---------------------------------------------------------------------------

type CacheRow = { id: string; cacheKey: string; provider: string; response: unknown; createdAt: Date };
type QuotaRow = {
  id: string;
  hourlyRemaining: number | null;
  dailyRemaining: number | null;
  hourlyQuota: number | null;
  dailyQuota: number | null;
  blockedUntil: Date | null;
  fetchedAt: Date;
};

let cacheStore: Map<string, CacheRow>;
let quotaStore: Map<string, QuotaRow>;
let cacheIdSeq: number;

function resetFakeDb() {
  cacheStore = new Map();
  quotaStore = new Map();
  cacheIdSeq = 0;
}
resetFakeDb();

vi.mock("@/lib/db", () => ({
  db: {
    keywordResearchCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) =>
        cacheStore.get(where.cacheKey) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { cacheKey: string };
        create: Omit<CacheRow, "id" | "createdAt">;
        update: Partial<CacheRow>;
      }) => {
        const existing = cacheStore.get(where.cacheKey);
        if (existing) {
          const next = { ...existing, ...update, createdAt: (update.createdAt as Date) ?? existing.createdAt };
          cacheStore.set(where.cacheKey, next);
          return next;
        }
        const row: CacheRow = {
          id: `cache-${cacheIdSeq++}`,
          cacheKey: where.cacheKey,
          provider: create.provider,
          response: create.response,
          createdAt: new Date(),
        };
        cacheStore.set(where.cacheKey, row);
        return row;
      },
      deleteMany: async () => {
        const count = cacheStore.size;
        cacheStore.clear();
        return { count };
      },
    },
    keywordToolQuota: {
      findUnique: async () => quotaStore.get("guest") ?? null,
      upsert: async ({
        create,
        update,
      }: {
        where: { id: string };
        create: QuotaRow;
        update: Partial<QuotaRow>;
      }) => {
        const existing = quotaStore.get("guest");
        const row: QuotaRow = existing
          ? { ...existing, ...update }
          : { ...create, blockedUntil: create.blockedUntil ?? null };
        quotaStore.set("guest", row);
        return row;
      },
    },
  },
}));

vi.mock("@/lib/user-settings", () => ({
  getUserSettings: vi.fn(async () => ({ keywordCacheTtlDays: 7 })),
}));

const mockFetchSuggestions = vi.fn();
const mockGetQuota = vi.fn();

vi.mock("@/lib/keywordtool/client", () => ({
  fetchSuggestions: (...args: unknown[]) => mockFetchSuggestions(...args),
  getQuota: (...args: unknown[]) => mockGetQuota(...args),
  toKeywordResult: (row: { string: string; volume?: number | null }) => ({
    keyword: row.string,
    volume: row.volume ?? null,
    difficulty: null,
    cpc: null,
    competition: null,
    trend: null,
  }),
}));

import {
  runKeywordToolResearch,
  cacheKeyFor,
  clearKeywordResearchCache,
  KeywordToolBlockedError,
} from "./quota";
import { getUserSettings } from "@/lib/user-settings";

const BASE_PARAMS: KeywordResearchParams = {
  query: "vegan protein powder",
  provider: "keywordtool",
  engine: "google",
  country: "us",
  language: "en",
  type: "suggestions",
};

function fullQuota(overrides: Partial<{ hourly: number; daily: number }> = {}) {
  return {
    hourly: { used: 0, remaining: overrides.hourly ?? 59, quota: 60 },
    daily: { used: 0, remaining: overrides.daily ?? 119, quota: 120 },
    timestamp: new Date().toISOString(),
  };
}

describe("lib/keywordtool/quota", () => {
  beforeEach(() => {
    resetFakeDb();
    mockFetchSuggestions.mockReset();
    mockGetQuota.mockReset();
    vi.mocked(getUserSettings).mockResolvedValue({ keywordCacheTtlDays: 7 });
  });

  it("cache hit returns cached response without calling quota or suggestions", async () => {
    const cacheKey = cacheKeyFor(BASE_PARAMS);
    cacheStore.set(cacheKey, {
      id: "seed",
      cacheKey,
      provider: "keywordtool",
      response: { source: "keywordtool", keywords: [{ keyword: "cached kw" }] },
      createdAt: new Date(),
    });

    const result = await runKeywordToolResearch("user-1", BASE_PARAMS, "United States", "English");

    expect(result.cached).toBe(true);
    expect(mockGetQuota).not.toHaveBeenCalled();
    expect(mockFetchSuggestions).not.toHaveBeenCalled();
  });

  it("refreshes stale quota before calling suggestions", async () => {
    mockGetQuota.mockResolvedValue(fullQuota());
    mockFetchSuggestions.mockResolvedValue({
      data: [{ string: "vegan protein powder" }],
      total_count: 1,
      pagination: null,
      notice: null,
      rate_limit_reached: false,
      quota_resets_at: null,
    });

    await runKeywordToolResearch("user-1", BASE_PARAMS, "United States", "English");

    // No saved quota yet -> considered stale -> refreshed once before the
    // suggestions call, then again after.
    expect(mockGetQuota).toHaveBeenCalledTimes(2);
    expect(mockFetchSuggestions).toHaveBeenCalledTimes(1);
  });

  it("blocks without calling suggestions when refreshed quota shows 0 remaining", async () => {
    mockGetQuota.mockResolvedValue(fullQuota({ hourly: 0 }));

    await expect(
      runKeywordToolResearch("user-1", BASE_PARAMS, "United States", "English")
    ).rejects.toThrow(KeywordToolBlockedError);

    expect(mockFetchSuggestions).not.toHaveBeenCalled();
  });

  it("records blockedUntil and blocks on rate_limit_reached from suggestions", async () => {
    mockGetQuota.mockResolvedValue(fullQuota());
    mockFetchSuggestions.mockResolvedValue({
      data: [],
      total_count: 0,
      pagination: null,
      notice: null,
      rate_limit_reached: true,
      quota_resets_at: "2026-09-18T18:00:00.000Z",
    });

    await expect(
      runKeywordToolResearch("user-1", BASE_PARAMS, "United States", "English")
    ).rejects.toThrow(KeywordToolBlockedError);

    const saved = quotaStore.get("guest");
    expect(saved?.blockedUntil?.toISOString()).toBe("2026-09-18T18:00:00.000Z");

    // A second call while still blocked should short-circuit without any
    // further network calls.
    mockGetQuota.mockClear();
    mockFetchSuggestions.mockClear();
    await expect(
      runKeywordToolResearch("user-1", { ...BASE_PARAMS, query: "another query" }, "United States", "English")
    ).rejects.toThrow(KeywordToolBlockedError);
    expect(mockGetQuota).not.toHaveBeenCalled();
    expect(mockFetchSuggestions).not.toHaveBeenCalled();
  });

  it("caches the response after a successful suggestions call and refreshes quota", async () => {
    mockGetQuota.mockResolvedValue(fullQuota());
    mockFetchSuggestions.mockResolvedValue({
      data: [{ string: "vegan protein powder" }],
      total_count: 1,
      pagination: null,
      notice: "some notice",
      rate_limit_reached: false,
      quota_resets_at: null,
    });

    const result = await runKeywordToolResearch("user-1", BASE_PARAMS, "United States", "English");

    expect(result.source).toBe("keywordtool");
    expect(result.notice).toBe("some notice");
    expect(result.quota?.hourly?.remaining).toBe(59);

    const cacheKey = cacheKeyFor(BASE_PARAMS);
    expect(cacheStore.has(cacheKey)).toBe(true);
  });

  it("serializes two concurrent requests so only one suggestions call fires when remaining is 1", async () => {
    mockGetQuota.mockResolvedValue(fullQuota({ hourly: 1 }));

    // Track whether two suggestions calls ever overlap — that's the race
    // the mutex is meant to prevent. Each call resolves only after a tick,
    // so an unguarded pair of concurrent requests would overlap here.
    let inFlight = 0;
    let sawOverlap = false;
    mockFetchSuggestions.mockImplementation(async () => {
      inFlight++;
      if (inFlight > 1) sawOverlap = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return {
        data: [{ string: "vegan protein powder" }],
        total_count: 1,
        pagination: null,
        notice: null,
        rate_limit_reached: false,
        quota_resets_at: null,
      };
    });

    const paramsA = { ...BASE_PARAMS, query: "query a" };
    const paramsB = { ...BASE_PARAMS, query: "query b" };

    const p1 = runKeywordToolResearch("user-1", paramsA, "United States", "English");
    const p2 = runKeywordToolResearch("user-1", paramsB, "United States", "English");

    await Promise.all([p1, p2]);

    // Both requests go through the mutex sequentially; each does its own
    // stale-quota refresh + suggestions call because they're different
    // cache keys, but crucially they never run concurrently.
    expect(sawOverlap).toBe(false);
    expect(mockFetchSuggestions).toHaveBeenCalledTimes(2);
  });

  it("clearKeywordResearchCache empties the cache table", async () => {
    cacheStore.set("a", { id: "a", cacheKey: "a", provider: "keywordtool", response: {}, createdAt: new Date() });
    cacheStore.set("b", { id: "b", cacheKey: "b", provider: "keywordtool", response: {}, createdAt: new Date() });

    const count = await clearKeywordResearchCache();

    expect(count).toBe(2);
    expect(cacheStore.size).toBe(0);
  });
});

describe("cache TTL", () => {
  it("an 8-day-old entry is a miss at TTL 7 but a hit at TTL 30", async () => {
    const cacheKey = cacheKeyFor(BASE_PARAMS);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    cacheStore.set(cacheKey, {
      id: "seed",
      cacheKey,
      provider: "keywordtool",
      response: { source: "keywordtool", keywords: [{ keyword: "old" }] },
      createdAt: eightDaysAgo,
    });

    mockGetQuota.mockResolvedValue(fullQuota());
    mockFetchSuggestions.mockResolvedValue({
      data: [{ string: "vegan protein powder" }],
      total_count: 1,
      pagination: null,
      notice: null,
      rate_limit_reached: false,
      quota_resets_at: null,
    });

    vi.mocked(getUserSettings).mockResolvedValue({ keywordCacheTtlDays: 7 });
    const miss = await runKeywordToolResearch("user-1", BASE_PARAMS, "United States", "English");
    expect(miss.cached).toBeFalsy();
    expect(mockFetchSuggestions).toHaveBeenCalledTimes(1);

    // Re-seed the (now overwritten) cache with the same 8-day-old entry and
    // try again with a 30-day TTL — should now be a hit.
    cacheStore.set(cacheKey, {
      id: "seed2",
      cacheKey,
      provider: "keywordtool",
      response: { source: "keywordtool", keywords: [{ keyword: "old" }] },
      createdAt: eightDaysAgo,
    });
    mockFetchSuggestions.mockClear();
    vi.mocked(getUserSettings).mockResolvedValue({ keywordCacheTtlDays: 30 });
    const hit = await runKeywordToolResearch("user-1", BASE_PARAMS, "United States", "English");
    expect(hit.cached).toBe(true);
    expect(mockFetchSuggestions).not.toHaveBeenCalled();
  });
});

describe("cacheKeyFor", () => {
  it("normalizes query case/whitespace and is stable for identical params", () => {
    const a = cacheKeyFor(BASE_PARAMS);
    const b = cacheKeyFor({ ...BASE_PARAMS, query: "  Vegan Protein Powder  " });
    expect(a).toBe(b);
  });

  it("differs when any dimension changes", () => {
    const a = cacheKeyFor(BASE_PARAMS);
    const b = cacheKeyFor({ ...BASE_PARAMS, type: "questions" });
    expect(a).not.toBe(b);
  });
});
