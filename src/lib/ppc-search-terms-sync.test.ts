import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./db/client", () => ({ db: {} }));

import { hashSearchTerm, mergeKeywordRows, mergeSearchTermRows } from "./ppc-search-terms-sync";
import type { KeywordDailyRow, SearchTermDailyRow } from "./google-ads";

const term = (over: Partial<SearchTermDailyRow> = {}): SearchTermDailyRow => ({
  date: "2026-11-01",
  campaignId: "1",
  campaignName: "Search",
  adGroupId: "10",
  adGroupName: "AG",
  searchTerm: "car accident lawyer",
  keywordText: "accident lawyer",
  keywordMatchType: "PHRASE",
  searchTermMatchType: "PHRASE",
  clicks: 1,
  impressions: 5,
  costMicros: 2_000_000n,
  conversions: 0.5,
  conversionsValue: 0,
  ...over,
});

const kw = (over: Partial<KeywordDailyRow> = {}): KeywordDailyRow => ({
  date: "2026-11-01",
  campaignId: "1",
  campaignName: "Search",
  adGroupId: "10",
  adGroupName: "AG",
  criterionId: "100",
  keywordText: "accident lawyer",
  matchType: "PHRASE",
  clicks: 2,
  impressions: 9,
  costMicros: 3_000_000n,
  conversions: 1,
  conversionsValue: 0,
  ...over,
});

describe("mergeSearchTermRows", () => {
  it("sums rows sharing the unique key and keeps distinct keys apart", () => {
    const out = mergeSearchTermRows([
      term(),
      term({ clicks: 2, costMicros: 1_000_000n, conversions: 0.25 }),
      term({ searchTermMatchType: "EXACT" }),
      term({ date: "2026-11-02" }),
      term({ keywordText: "lawyer" }),
    ]);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ clicks: 3, impressions: 10, costMicros: 3_000_000n, conversions: 0.75 });
  });

  it("drops rows with no date, ad group or term", () => {
    expect(mergeSearchTermRows([term({ date: "" }), term({ searchTerm: "" }), term({ adGroupId: "" })])).toEqual([]);
  });
});

describe("mergeKeywordRows", () => {
  it("sums rows sharing ad group + criterion + date", () => {
    const out = mergeKeywordRows([kw(), kw({ clicks: 1 }), kw({ criterionId: "101" })]);
    expect(out).toHaveLength(2);
    expect(out[0].clicks).toBe(3);
  });
});

describe("hashSearchTerm", () => {
  it("is a stable 32-char md5", () => {
    expect(hashSearchTerm("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });
});

// Durable invariants for these queries: primary conversions only, and no
// status filter alongside a historical date range.
describe("keyword / search-term GAQL", () => {
  const src = readFileSync(join(process.cwd(), "src", "lib", "google-ads.ts"), "utf8");
  const section = src.slice(src.indexOf("Keyword + search-term reporting"));

  it("never selects all_conversions", () => {
    expect(section).not.toMatch(/metrics\.all_conversions/);
  });

  it("never filters on a status field", () => {
    const wheres = [...section.matchAll(/WHERE[\s\S]*?`/g)].map((m) => m[0]);
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) expect(w).not.toMatch(/status/);
    expect(section).not.toMatch(/AND [a-z_.]*status/);
  });
});
