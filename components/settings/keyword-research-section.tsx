"use client";

import { useState } from "react";
import { Loader2, Trash2, CheckCircle2 } from "lucide-react";

const TTL_OPTIONS = [7, 30] as const;

export function KeywordResearchSection({
  initialTtlDays,
}: {
  initialTtlDays: number;
}) {
  const [ttlDays, setTtlDays] = useState<number>(initialTtlDays);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearedCount, setClearedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveTtl(next: number) {
    setTtlDays(next);
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordCacheTtlDays: next }),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save");
      }
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearCache() {
    setClearing(true);
    setClearedCount(null);
    setError(null);

    try {
      const res = await fetch("/api/keyword-research/cache", { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        setClearedCount(data.cleared ?? 0);
      } else {
        setError("Failed to clear cache");
      }
    } catch {
      setError("Failed to clear cache");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="panel p-5">
      <h3 className="font-heading text-lg font-semibold text-foreground">
        Keyword Research
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Keyword research results (from any provider) are cached to avoid
        repeat requests and save on paid API calls.
      </p>

      <div className="mt-5 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="font-medium text-foreground">Cache duration</h4>
            <p className="text-xs text-muted-foreground">
              How long results are reused before a fresh lookup runs
            </p>
          </div>
          <select
            value={ttlDays}
            onChange={(e) => handleSaveTtl(Number(e.target.value))}
            disabled={saving}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          >
            {TTL_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </div>

        {saved && !saving && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-signal">
            <CheckCircle2 className="size-3.5" />
            Saved
          </p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <div>
            <p className="text-xs text-muted-foreground">
              {clearedCount !== null
                ? `Cleared ${clearedCount} cached ${clearedCount === 1 ? "entry" : "entries"}`
                : "Force fresh results on the next search"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearing}
            className="flex items-center gap-1.5 rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
          >
            {clearing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            Wyczyść cache
          </button>
        </div>

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
