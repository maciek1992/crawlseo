import { createHash } from "crypto";
import { db } from "@/lib/db";
import { getUserSettings } from "@/lib/user-settings";
import * as keywordToolClient from "@/lib/keywordtool/client";
import type {
  KeywordResearchParams,
  KeywordResearchQuota,
  KeywordResearchResponse,
} from "@/lib/keyword-research/types";

// Quota is refreshed if the last saved read is older than this, or if it
// last reported 0 remaining but the recorded block has since expired.
const QUOTA_STALE_MS = 60_000;

export class KeywordToolBlockedError extends Error {
  blockedUntil: Date;
  constructor(blockedUntil: Date) {
    super("Keyword Tool rate limit reached");
    this.blockedUntil = blockedUntil;
  }
}

// ---------------------------------------------------------------------------
// Local mutex — race-condition protection only, NOT a rate limiter.
//
// keywordtool-quota-guest's remaining count is the only source of truth (the
// limit is almost certainly enforced per-IP by keywordtool.io, shared with
// any other MCP client on this network — a counter kept in our own DB would
// drift). This in-process Promise queue exists purely so two concurrent
// requests from this Next.js instance don't both read "remaining: 1" and
// both fire a suggestions call. It does not count anything and is never
// shown to the user.
//
// NOTE: this only works because we run a single Next.js instance/replica.
// With >1 replica, replace this with a real cross-process lock — e.g.
// Postgres `pg_advisory_lock` or a Redis lock.
// ---------------------------------------------------------------------------
let mutexQueue: Promise<unknown> = Promise.resolve();

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutexQueue.then(fn, fn);
  // Swallow errors for chaining purposes only — the caller still gets them
  // via `run`.
  mutexQueue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export function cacheKeyFor(params: KeywordResearchParams): string {
  const normalizedQuery = params.query.trim().toLowerCase();
  const raw = [
    params.provider,
    params.engine,
    params.country,
    params.language,
    params.type,
    normalizedQuery,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

async function readCache(
  cacheKey: string,
  ttlDays: number
): Promise<KeywordResearchResponse | null> {
  const row = await db.keywordResearchCache.findUnique({ where: { cacheKey } });
  if (!row) return null;

  const expiresAt = row.createdAt.getTime() + ttlDays * 24 * 60 * 60 * 1000;
  if (expiresAt <= Date.now()) return null;

  return row.response as unknown as KeywordResearchResponse;
}

async function writeCache(
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

export async function clearKeywordResearchCache(): Promise<number> {
  const result = await db.keywordResearchCache.deleteMany({});
  return result.count;
}

// ---------------------------------------------------------------------------
// Quota (server-side source of truth, cached in KeywordToolQuota)
// ---------------------------------------------------------------------------

function toQuotaResponse(row: {
  hourlyRemaining: number | null;
  dailyRemaining: number | null;
  hourlyQuota: number | null;
  dailyQuota: number | null;
  blockedUntil: Date | null;
  fetchedAt: Date;
}): KeywordResearchQuota {
  return {
    hourly:
      row.hourlyRemaining != null && row.hourlyQuota != null
        ? {
            remaining: row.hourlyRemaining,
            quota: row.hourlyQuota,
            used: row.hourlyQuota - row.hourlyRemaining,
          }
        : null,
    daily:
      row.dailyRemaining != null && row.dailyQuota != null
        ? {
            remaining: row.dailyRemaining,
            quota: row.dailyQuota,
            used: row.dailyQuota - row.dailyRemaining,
          }
        : null,
    fetchedAt: row.fetchedAt.toISOString(),
    blockedUntil: row.blockedUntil ? row.blockedUntil.toISOString() : null,
  };
}

async function readSavedQuota() {
  return db.keywordToolQuota.findUnique({ where: { id: "guest" } });
}

async function refreshQuota() {
  const quota = await keywordToolClient.getQuota();
  return db.keywordToolQuota.upsert({
    where: { id: "guest" },
    create: {
      id: "guest",
      hourlyRemaining: quota.hourly?.remaining ?? null,
      hourlyQuota: quota.hourly?.quota ?? null,
      dailyRemaining: quota.daily?.remaining ?? null,
      dailyQuota: quota.daily?.quota ?? null,
      fetchedAt: new Date(),
    },
    update: {
      hourlyRemaining: quota.hourly?.remaining ?? null,
      hourlyQuota: quota.hourly?.quota ?? null,
      dailyRemaining: quota.daily?.remaining ?? null,
      dailyQuota: quota.daily?.quota ?? null,
      fetchedAt: new Date(),
    },
  });
}

async function recordBlock(blockedUntil: Date) {
  return db.keywordToolQuota.upsert({
    where: { id: "guest" },
    create: {
      id: "guest",
      hourlyRemaining: 0,
      dailyRemaining: 0,
      blockedUntil,
      fetchedAt: new Date(),
    },
    update: {
      hourlyRemaining: 0,
      blockedUntil,
      fetchedAt: new Date(),
    },
  });
}

/** Public: get the last-known quota state, refreshing from the server when asked. */
export async function getSavedOrRefreshedQuota(
  refresh: boolean
): Promise<KeywordResearchQuota> {
  if (refresh) {
    const row = await withMutex(() => refreshQuota());
    return toQuotaResponse(row);
  }
  const row = await readSavedQuota();
  if (!row) {
    return {
      hourly: null,
      daily: null,
      fetchedAt: new Date(0).toISOString(),
      blockedUntil: null,
    };
  }
  return toQuotaResponse(row);
}

// ---------------------------------------------------------------------------
// Orchestration: cache → quota → suggestions → quota → cache
// ---------------------------------------------------------------------------

export async function runKeywordToolResearch(
  userId: string,
  params: KeywordResearchParams,
  ktCountry: string,
  ktLanguage: string
): Promise<KeywordResearchResponse> {
  const settings = await getUserSettings(userId);
  const cacheKey = cacheKeyFor(params);

  // 1. Cache hit → zero requests, not even quota.
  const cached = await readCache(cacheKey, settings.keywordCacheTtlDays);
  if (cached) {
    return { ...cached, cached: true };
  }

  // Steps 2-5 (quota check → suggestions → quota refresh) are wrapped in the
  // local mutex — see comment above withMutex.
  const response = await withMutex(async () => {
    // 2. Check saved quota / block state first, without hitting the network.
    let saved = await readSavedQuota();

    if (saved?.blockedUntil && saved.blockedUntil.getTime() > Date.now()) {
      throw new KeywordToolBlockedError(saved.blockedUntil);
    }

    // 3. Refresh if stale, missing, or previously exhausted (and the block
    // window — if any — has passed).
    const isStale =
      !saved || Date.now() - saved.fetchedAt.getTime() > QUOTA_STALE_MS;
    const wasExhausted =
      saved && (saved.hourlyRemaining === 0 || saved.dailyRemaining === 0);

    if (isStale || wasExhausted) {
      saved = await refreshQuota();
      if (saved.hourlyRemaining === 0 || saved.dailyRemaining === 0) {
        // No reset time known outside of a rate_limit_reached response —
        // block until we're willing to re-check (the stale window).
        const blockedUntil = new Date(Date.now() + QUOTA_STALE_MS);
        await recordBlock(blockedUntil);
        throw new KeywordToolBlockedError(blockedUntil);
      }
    }

    // 4. Suggestions call.
    const result = await keywordToolClient.fetchSuggestions({
      keyword: params.query,
      platform: params.engine,
      country: ktCountry,
      language: ktLanguage,
      type: params.type,
    });

    // 6. Rate limit hit mid-call → record blockedUntil from quota_resets_at.
    if (result.rate_limit_reached) {
      const blockedUntil = result.quota_resets_at
        ? new Date(result.quota_resets_at)
        : new Date(Date.now() + QUOTA_STALE_MS);
      await recordBlock(blockedUntil);
      throw new KeywordToolBlockedError(blockedUntil);
    }

    // 5. Refresh quota after the call so the UI reflects the new remaining count.
    const afterQuota = await refreshQuota();

    const keywords = result.data.map(keywordToolClient.toKeywordResult);

    return {
      source: "keywordtool" as const,
      keywords,
      notice: result.notice ?? undefined,
      quota: toQuotaResponse(afterQuota),
    };
  });

  await writeCache(cacheKey, "keywordtool", response);
  return response;
}
