import { db } from "@/lib/db";

// General per-user settings — not specific to keyword research. The
// `UserSettings` row is created lazily (upsert) on first write; if no row
// exists yet, callers get the defaults below. Future settings get added as
// new typed columns with defaults (additive migrations, no backfill).

export type UserSettingsValue = {
  keywordCacheTtlDays: number;
};

export const DEFAULT_USER_SETTINGS: UserSettingsValue = {
  keywordCacheTtlDays: 7,
};

export const ALLOWED_KEYWORD_CACHE_TTL_DAYS = [7, 30] as const;

export async function getUserSettings(userId: string): Promise<UserSettingsValue> {
  const row = await db.userSettings.findUnique({ where: { userId } });
  if (!row) return { ...DEFAULT_USER_SETTINGS };
  return { keywordCacheTtlDays: row.keywordCacheTtlDays };
}

export async function updateUserSettings(
  userId: string,
  patch: Partial<UserSettingsValue>
): Promise<UserSettingsValue> {
  const row = await db.userSettings.upsert({
    where: { userId },
    create: { userId, ...DEFAULT_USER_SETTINGS, ...patch },
    update: { ...patch },
  });
  return { keywordCacheTtlDays: row.keywordCacheTtlDays };
}
