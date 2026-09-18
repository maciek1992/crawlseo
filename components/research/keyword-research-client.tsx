"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Loader2,
  Bookmark,
  Check,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import {
  COUNTRIES,
  LANGUAGES,
  DEFAULT_COUNTRY_ID,
  DEFAULT_LANGUAGE_ID,
} from "@/lib/keyword-research/locales";
import type {
  KeywordResearchProvider,
  KeywordSearchEngine,
  KeywordResearchType,
  KeywordResearchQuota,
} from "@/lib/keyword-research/types";

type KeywordResult = {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number[] | null;
};

const STORAGE_KEY = "keyword-research-controls";

type StoredControls = {
  provider: KeywordResearchProvider;
  engine: KeywordSearchEngine;
  country: string;
  language: string;
  type: KeywordResearchType;
};

function loadStoredControls(): StoredControls | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredControls;
  } catch {
    return null;
  }
}

function saveStoredControls(controls: StoredControls) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
  } catch {
    // ignore (private mode, quota, etc.)
  }
}

export function KeywordResearchClient({
  siteId,
  hasDataForSEO,
}: {
  siteId: string;
  hasDataForSEO: boolean;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<KeywordResult[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());
  const [savingSet, setSavingSet] = useState<Set<string>>(new Set());

  const [provider, setProvider] = useState<KeywordResearchProvider>("keywordtool");
  const [engine, setEngine] = useState<KeywordSearchEngine>("google");
  const [country, setCountry] = useState(DEFAULT_COUNTRY_ID);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE_ID);
  const [type, setType] = useState<KeywordResearchType>("suggestions");

  const [quota, setQuota] = useState<KeywordResearchQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);

  // Restore persisted control choices on mount.
  useEffect(() => {
    const stored = loadStoredControls();
    if (stored) {
      setProvider(stored.provider);
      setEngine(stored.engine);
      setCountry(stored.country);
      setLanguage(stored.language);
      setType(stored.type);
    }
  }, []);

  // Load quota on mount (Keyword Tool provider only).
  useEffect(() => {
    refreshQuota();
  }, []);

  useEffect(() => {
    saveStoredControls({ provider, engine, country, language, type });
  }, [provider, engine, country, language, type]);

  async function refreshQuota() {
    setQuotaLoading(true);
    try {
      const res = await fetch("/api/keywordtool/quota?refresh=1");
      if (res.ok) {
        const data = (await res.json()) as KeywordResearchQuota;
        setQuota(data);
        setBlockedUntil(data.blockedUntil);
      }
    } catch {
      // ignore — quota display is best-effort
    } finally {
      setQuotaLoading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    if (provider === "keywordtool" && blockedUntil && new Date(blockedUntil) > new Date()) {
      return;
    }

    setLoading(true);
    setResults([]);
    setSource(null);
    setNotice(null);
    setCached(false);

    try {
      const params = new URLSearchParams({
        q: query.trim(),
        provider,
        engine,
        country,
        language,
        type,
      });
      const res = await fetch(`/api/sites/${siteId}/keyword-research?${params.toString()}`);

      if (res.status === 429) {
        const data = await res.json();
        setBlockedUntil(data.blockedUntil ?? null);
        setResults([]);
        setSource(provider);
        return;
      }

      const data = await res.json();
      setResults(data.keywords ?? []);
      setSource(data.source ?? null);
      setNotice(data.notice ?? null);
      setCached(data.cached === true);
      if (data.quota) {
        setQuota(data.quota);
        setBlockedUntil(data.quota.blockedUntil ?? null);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(keyword: string) {
    setSavingSet((prev) => new Set(prev).add(keyword));

    try {
      const res = await fetch(`/api/sites/${siteId}/saved-keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: keyword }),
      });
      if (res.ok) {
        setSavedSet((prev) => new Set(prev).add(keyword));
      }
    } catch {
      // ignore
    } finally {
      setSavingSet((prev) => {
        const next = new Set(prev);
        next.delete(keyword);
        return next;
      });
    }
  }

  const isBlocked =
    provider === "keywordtool" && !!blockedUntil && new Date(blockedUntil) > new Date();
  const hasMetrics = source === "dataforseo" || source === "keywordtool";

  return (
    <div className="space-y-4">
      {/* Provider selection */}
      <div className="panel space-y-3 p-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Provider
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <ProviderOption
              label="Keyword Tool (Guest)"
              description="Google/Bing suggestions · Limited metrics · 120 requests/day"
              selected={provider === "keywordtool"}
              onSelect={() => setProvider("keywordtool")}
            />
            <ProviderOption
              label="Google Autocomplete"
              description="Suggestions only · no metrics"
              selected={provider === "autocomplete"}
              onSelect={() => setProvider("autocomplete")}
            />
            <ProviderOption
              label="DataForSEO"
              description="Full metrics · paid"
              selected={provider === "dataforseo"}
              onSelect={() => hasDataForSEO && setProvider("dataforseo")}
              disabled={!hasDataForSEO}
              disabledHint={
                <>
                  Requires an API key —{" "}
                  <Link
                    href={`/sites/${siteId}/settings`}
                    className="text-primary underline underline-offset-2"
                  >
                    Settings
                  </Link>
                </>
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ControlSelect
            label="Search engine"
            value={engine}
            onChange={(v) => setEngine(v as KeywordSearchEngine)}
            options={[
              { value: "google", label: "Google" },
              { value: "bing", label: "Bing", disabled: provider === "dataforseo" },
            ]}
          />
          <ControlSelect
            label="Country"
            value={country}
            onChange={setCountry}
            options={COUNTRIES.map((c) => ({ value: c.id, label: c.label }))}
          />
          <ControlSelect
            label="Language"
            value={language}
            onChange={setLanguage}
            options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
          />
          <ControlSelect
            label="Type"
            value={type}
            onChange={(v) => setType(v as KeywordResearchType)}
            options={[
              { value: "suggestions", label: "Suggestions" },
              {
                value: "questions",
                label: "Questions",
                disabled: provider === "dataforseo",
              },
              {
                value: "prepositions",
                label: "Prepositions",
                disabled: provider === "dataforseo",
              },
            ]}
          />
        </div>

        {/* Quota indicator (Keyword Tool only) */}
        {provider === "keywordtool" && (
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span>
              {isBlocked && blockedUntil ? (
                <span className="text-danger">
                  Limit wyczerpany, reset o{" "}
                  {new Date(blockedUntil).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ) : quota?.hourly && quota?.daily ? (
                <>
                  Zostało {quota.hourly.remaining}/{quota.hourly.quota} w tej godzinie ·{" "}
                  {quota.daily.remaining}/{quota.daily.quota} dziś · stan z{" "}
                  {new Date(quota.fetchedAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              ) : (
                "Quota unknown"
              )}
            </span>
            <button
              type="button"
              onClick={refreshQuota}
              disabled={quotaLoading}
              className="flex items-center gap-1 text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`size-3 ${quotaLoading ? "animate-spin" : ""}`} />
              Odśwież
            </button>
          </div>
        )}
      </div>

      {/* Autocomplete fallback banner */}
      {provider === "dataforseo" && !hasDataForSEO && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              Limited data — Google Autocomplete only
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Add a DataForSEO API key in{" "}
              <Link
                href={`/sites/${siteId}/settings`}
                className="text-primary underline underline-offset-2"
              >
                Settings
              </Link>{" "}
              for search volume, difficulty, and CPC data.
            </p>
          </div>
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </div>
      )}

      {/* Search input */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a seed keyword..."
            className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || loading || isBlocked}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Research
        </button>
      </form>

      {/* Results */}
      {results.length > 0 && (
        <div className="panel overflow-hidden">
          {source === "autocomplete" && (
            <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              Showing Google Autocomplete suggestions — volume and difficulty data
              requires DataForSEO or Keyword Tool
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">
                    Keyword
                  </th>
                  {hasMetrics && (
                    <>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Volume
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Difficulty
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        CPC
                      </th>
                    </>
                  )}
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => {
                  const isSaved = savedSet.has(result.keyword);
                  const isSaving = savingSet.has(result.keyword);

                  return (
                    <tr
                      key={result.keyword}
                      className="border-b border-border/50 transition-colors hover:bg-muted/25"
                    >
                      <td className="max-w-md px-4 py-3">
                        <span className="font-medium text-foreground">
                          {result.keyword}
                        </span>
                      </td>
                      {hasMetrics && (
                        <>
                          <td className="px-4 py-3 text-right font-data text-foreground">
                            {result.volume?.toLocaleString() ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <DifficultyBadge value={result.difficulty} />
                          </td>
                          <td className="px-4 py-3 text-right font-data text-foreground">
                            {result.cpc != null ? `$${result.cpc.toFixed(2)}` : "—"}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleSave(result.keyword)}
                          disabled={isSaved || isSaving}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          {isSaved ? (
                            <>
                              <Check className="size-3 text-signal" />
                              Saved
                            </>
                          ) : isSaving ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <>
                              <Bookmark className="size-3" />
                              Save
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
            <span>
              {results.length} keyword{results.length !== 1 ? "s" : ""} found via{" "}
              {source}
            </span>
            {cached && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                z cache
              </span>
            )}
          </div>
        </div>
      )}

      {/* Empty state after search */}
      {!loading && results.length === 0 && source !== null && !isBlocked && (
        <div className="panel flex flex-col items-center py-12 text-center">
          <Search className="size-10 text-muted-foreground/30" />
          <p className="mt-3 font-medium text-foreground">No results found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a different seed keyword
          </p>
        </div>
      )}
    </div>
  );
}

function DifficultyBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="font-data text-muted-foreground">—</span>;

  let color = "text-signal";
  if (value >= 70) color = "text-danger";
  else if (value >= 40) color = "text-warning";

  return (
    <span className={`font-data font-medium ${color}`}>{value}</span>
  );
}

function ProviderOption({
  label,
  description,
  selected,
  onSelect,
  disabled,
  disabledHint,
}: {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  disabledHint?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/40"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span
          className={`inline-block size-2.5 rounded-full border ${
            selected ? "border-primary bg-primary" : "border-border"
          }`}
        />
        {label}
      </span>
      <span className="text-xs text-muted-foreground">
        {disabled && disabledHint ? disabledHint : description}
      </span>
    </button>
  );
}

function ControlSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
