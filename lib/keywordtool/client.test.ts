import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP SDK client so we can control what `callTool` returns without
// making a real network call to https://mcp.keywordtool.io/guest.
const mockCallTool = vi.fn();
const mockConnect = vi.fn(async () => {});
const mockClose = vi.fn(async () => {});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mockConnect;
    callTool = mockCallTool;
    close = mockClose;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));

import { fetchSuggestions, getQuota, toKeywordResult } from "./client";

// Shape modeled on the live probe documented in PLAN-KEYWORDTOOL.md:
// result.structuredContent: data[] {string, metrics_status, volume, trend,
// cmp, cpc, top_of_page_bid_low/high}, total_count, pagination, notice.
const SAMPLE_STRUCTURED_CONTENT = {
  data: [
    {
      string: "vegan protein powder",
      metrics_status: "available",
      volume: 40500,
      trend: [100, 95, 110, 120, 130],
      cmp: 0.42,
      cpc: 1.23,
      top_of_page_bid_low: 0.8,
      top_of_page_bid_high: 1.9,
    },
    {
      string: "vegan protein powder for weight loss",
      metrics_status: "unavailable",
      volume: null,
      trend: null,
      cmp: null,
      cpc: null,
      top_of_page_bid_low: null,
      top_of_page_bid_high: null,
    },
  ],
  total_count: 2,
  pagination: { next_page: null },
  notice: "Metrics available for the first 5 rows only, when cached.",
};

describe("keywordtool client fetchSuggestions", () => {
  beforeEach(() => {
    mockCallTool.mockReset();
    mockConnect.mockClear();
    mockClose.mockClear();
  });

  it("maps structuredContent rows into the expected shape", async () => {
    mockCallTool.mockResolvedValueOnce({ structuredContent: SAMPLE_STRUCTURED_CONTENT });

    const result = await fetchSuggestions({
      keyword: "vegan protein powder",
      platform: "google",
      country: "United States",
      language: "English",
      type: "suggestions",
    });

    expect(mockCallTool).toHaveBeenCalledWith({
      name: "keywordtool-suggestions-guest",
      arguments: expect.objectContaining({
        keyword: "vegan protein powder",
        platform: "google",
        country: "United States",
        language: "English",
        type: "suggestions",
        limit: 50,
      }),
    });

    expect(result.rate_limit_reached).toBe(false);
    expect(result.total_count).toBe(2);
    expect(result.notice).toContain("first 5 rows");
    expect(result.data).toHaveLength(2);
    expect(result.data[0].string).toBe("vegan protein powder");
  });

  it("falls back to parsing content[0].text when structuredContent is absent", async () => {
    mockCallTool.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(SAMPLE_STRUCTURED_CONTENT) }],
    });

    const result = await fetchSuggestions({
      keyword: "vegan protein powder",
      platform: "google",
      country: "Global / Worldwide",
      language: "English",
      type: "suggestions",
    });

    expect(result.data).toHaveLength(2);
    expect(result.total_count).toBe(2);
  });

  it("surfaces rate_limit_reached and quota_resets_at", async () => {
    mockCallTool.mockResolvedValueOnce({
      structuredContent: {
        data: [],
        total_count: 0,
        pagination: null,
        notice: null,
        rate_limit_reached: true,
        quota_resets_at: "2026-09-18T15:00:00.000Z",
      },
    });

    const result = await fetchSuggestions({
      keyword: "crm software",
      platform: "bing",
      country: "Global / Worldwide",
      language: "English",
      type: "questions",
    });

    expect(result.rate_limit_reached).toBe(true);
    expect(result.quota_resets_at).toBe("2026-09-18T15:00:00.000Z");
    expect(result.data).toHaveLength(0);
  });
});

describe("keywordtool client getQuota", () => {
  beforeEach(() => {
    mockCallTool.mockReset();
  });

  it("maps hourly/daily quota bands", async () => {
    mockCallTool.mockResolvedValueOnce({
      structuredContent: {
        hourly: { used: 13, remaining: 47, quota: 60 },
        daily: { used: 17, remaining: 103, quota: 120 },
        timestamp: "2026-09-18T14:32:00.000Z",
      },
    });

    const result = await getQuota();

    expect(result.hourly).toEqual({ used: 13, remaining: 47, quota: 60 });
    expect(result.daily).toEqual({ used: 17, remaining: 103, quota: 120 });
    expect(result.timestamp).toBe("2026-09-18T14:32:00.000Z");
  });
});

describe("toKeywordResult", () => {
  it("maps a Keyword Tool row onto the shared KeywordResult shape", () => {
    const row = SAMPLE_STRUCTURED_CONTENT.data[0];
    const mapped = toKeywordResult(row);

    expect(mapped).toEqual({
      keyword: "vegan protein powder",
      volume: 40500,
      difficulty: null,
      cpc: 1.23,
      competition: 0.42,
      trend: [100, 95, 110, 120, 130],
    });
  });

  it("falls back to top_of_page_bid_high for cpc when cpc is missing", () => {
    const mapped = toKeywordResult({
      string: "crm software",
      volume: 8000,
      cpc: null,
      top_of_page_bid_high: 12.5,
      cmp: 0.9,
      trend: null,
    });

    expect(mapped.cpc).toBe(12.5);
    expect(mapped.difficulty).toBeNull();
  });
});
