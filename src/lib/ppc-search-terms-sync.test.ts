import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./db/client", () => ({ db: {} }));

import {
  SYNC_COVERAGE_CAMPAIGN_ID,
  coverageMarkerRows,
  hashSearchTerm,
  mergeKeywordRows,
  mergeSearchTermRows,
  parseClientBatch,
  sliceClientBatch,
} from "./ppc-search-terms-sync";
import { deriveKeywordlessRows, type KeywordDailyRow, type SearchTermDailyRow } from "./google-ads";

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

describe("deriveKeywordlessRows", () => {
  it("returns only what the unsegmented query has beyond the keyworded rows", () => {
    const keyworded = [
      term({ clicks: 2, impressions: 4, costMicros: 5_000_000n, conversions: 1 }),
      term({ searchTermMatchType: "EXACT", clicks: 1, impressions: 1, costMicros: 1_000_000n, conversions: 0 }),
    ];
    const all = [
      // Same term: 5 clicks in total, 3 of them explained by keywords above.
      term({ keywordText: "", keywordMatchType: "", searchTermMatchType: "", clicks: 5, impressions: 9, costMicros: 10_000_000n, conversions: 1.5 }),
      // Fully explained elsewhere -> no row.
      term({ searchTerm: "other", clicks: 1 }),
      // Never matched a keyword at all.
      term({ searchTerm: "no keyword term", clicks: 4, costMicros: 8_000_000n }),
    ];
    const out = deriveKeywordlessRows([...keyworded, term({ searchTerm: "other", clicks: 1 })], all);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      searchTerm: "car accident lawyer",
      keywordText: "",
      keywordMatchType: "",
      clicks: 2,
      impressions: 4,
      costMicros: 4_000_000n,
      conversions: 0.5,
    });
    expect(out[1]).toMatchObject({ searchTerm: "no keyword term", clicks: 4, keywordText: "" });
  });

  it("never goes negative when keyworded rows exceed the unsegmented total", () => {
    const out = deriveKeywordlessRows(
      [term({ clicks: 1, conversions: 1, costMicros: 9_000_000n })],
      [term({ clicks: 2, conversions: 0.99, costMicros: 8_000_000n, impressions: 1 })],
    );
    expect(out[0]).toMatchObject({ clicks: 1, conversions: 0, costMicros: 0n, impressions: 0 });
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

describe("coverageMarkerRows", () => {
  it("writes one all-zero marker per date of the window", () => {
    const rows = coverageMarkerRows("2026-11-10", "2026-11-12");
    expect(rows.map((r) => r.date)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    for (const r of rows) {
      expect(r.campaignId).toBe(SYNC_COVERAGE_CAMPAIGN_ID);
      expect([r.clicks, r.impressions, r.conversions, r.conversionsValue]).toEqual([0, 0, 0, 0]);
      expect(r.costMicros).toBe(BigInt(0));
    }
  });
});

describe("batched backfill paging", () => {
  const clients = Array.from({ length: 20 }, (_, i) => `c${i}`);

  it("walks every client exactly once in groups, then stops", () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    let requests = 0;
    while (offset !== null) {
      const page: { selected: string[]; nextOffset: number | null } = sliceClientBatch(clients, {
        offset,
        limit: 8,
      });
      seen.push(...page.selected);
      offset = page.nextOffset;
      requests += 1;
    }
    expect(seen).toEqual(clients);
    expect(requests).toBe(3);
  });

  it("ends cleanly on an exact multiple and past the end", () => {
    expect(sliceClientBatch(clients, { offset: 10, limit: 10 })).toEqual({
      selected: clients.slice(10),
      nextOffset: null,
    });
    expect(sliceClientBatch(clients, { offset: 40, limit: 8 })).toEqual({ selected: [], nextOffset: null });
  });

  it("syncs everyone when no batch is given (the scheduled run)", () => {
    expect(sliceClientBatch(clients, undefined)).toEqual({ selected: clients, nextOffset: null });
    expect(parseClientBatch(null, null)).toEqual({ batch: undefined });
  });

  it("parses offset and limit, defaulting the missing one", () => {
    expect(parseClientBatch("16", "8")).toEqual({ batch: { offset: 16, limit: 8 } });
    expect(parseClientBatch(null, "5")).toEqual({ batch: { offset: 0, limit: 5 } });
    expect(parseClientBatch("8", null)).toEqual({ batch: { offset: 8, limit: 8 } });
  });

  it("rejects bad values instead of falling back to everyone", () => {
    for (const [o, l] of [
      ["-1", "8"],
      ["abc", "8"],
      ["1.5", "8"],
      ["", "8"],
      ["0", "0"],
      ["0", "51"],
      ["0", "x"],
    ]) {
      expect(parseClientBatch(o, l)).toHaveProperty("error");
    }
  });
});
