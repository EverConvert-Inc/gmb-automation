import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  datesInRange,
  easternMidnightReportHour,
  spendByDate,
  spendReportWindow,
} from "./reddit-sync";
import { buildRedditReport, priorWindow, UNMAPPED_KEY, type RedditReportAccount } from "./queries-reddit";

describe("report window", () => {
  it("bounds each Eastern day at Eastern midnight, across both DST offsets", () => {
    expect(easternMidnightReportHour("2026-10-20")).toBe("2026-10-20T04:00:00Z"); // EDT
    expect(easternMidnightReportHour("2026-12-01")).toBe("2026-12-01T05:00:00Z"); // EST
    // The day DST ends (Nov 1, 2026) still starts at 04:00Z; the next day at 05:00Z.
    expect(spendReportWindow("2026-11-01", "2026-11-01")).toEqual({
      startsAt: "2026-11-01T04:00:00Z",
      endsAt: "2026-11-02T05:00:00Z",
      timeZoneId: "America/New_York",
    });
  });

  it("lists inclusive dates across a month boundary", () => {
    expect(datesInRange("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("spendByDate", () => {
  it("zero-fills the window, sums duplicates, and drops rows outside it", () => {
    const out = spendByDate(
      [
        { date: "2026-10-20", spend: 1_500_000 },
        { date: "2026-10-20", spend: 500_000 },
        { date: "2026-10-22T00:00:00", spend: 3_000_000 },
        { date: "2026-10-19", spend: 9_000_000 },
        { date: null, spend: 7 },
      ],
      "2026-10-20",
      "2026-10-22",
    );
    expect([...out]).toEqual([
      ["2026-10-20", 2_000_000n],
      ["2026-10-21", 0n],
      ["2026-10-22", 3_000_000n],
    ]);
  });
});

function account(over: Partial<RedditReportAccount>): RedditReportAccount {
  return {
    id: "acc",
    name: "Acc",
    currency: "USD",
    isActive: true,
    redditClientId: null,
    redditClientName: null,
    lastSyncAt: null,
    lastSyncError: null,
    ...over,
  };
}

describe("buildRedditReport", () => {
  const accounts = [
    account({ id: "a1", name: "1Georgia", redditClientId: "c1", redditClientName: "1Georgia" }),
    account({ id: "a2", name: "1Georgia 2", redditClientId: "c1", redditClientName: "1Georgia" }),
    account({ id: "a3", name: "Weinstein", redditClientId: "c2", redditClientName: "Weinstein" }),
    account({ id: "a4", name: "Unassigned acct" }),
    account({ id: "a5", name: "Canada acct", currency: "CAD", redditClientId: "c2", redditClientName: "Weinstein" }),
    account({ id: "a6", name: "Paused", isActive: false, redditClientId: "c3", redditClientName: "Paused Co" }),
  ];
  const report = buildRedditReport({
    from: "2026-10-20",
    to: "2026-10-21",
    accounts,
    priorTotalMicros: 5_000_000n,
    rows: [
      { adAccountId: "a1", date: "2026-10-20", spendMicros: 10_000_000n },
      { adAccountId: "a2", date: "2026-10-20", spendMicros: 5_000_000n },
      { adAccountId: "a3", date: "2026-10-21", spendMicros: 20_000_000n },
      { adAccountId: "a4", date: "2026-10-21", spendMicros: 1_000_000n },
      { adAccountId: "a5", date: "2026-10-21", spendMicros: 99_000_000n },
    ],
  });

  it("groups accounts by client, highest spend first, Unmapped last", () => {
    expect(report.clients.map((c) => [c.key, c.name, c.accountCount, c.totalMicros])).toEqual([
      ["c2", "Weinstein", 1, 20_000_000n],
      ["c1", "1Georgia", 2, 15_000_000n],
      [UNMAPPED_KEY, "Unmapped", 1, 1_000_000n],
    ]);
  });

  it("keeps non-USD spend out of every total but lists the account", () => {
    expect(report.totalMicros).toBe(36_000_000n);
    expect(report.dailyTotals).toEqual({ "2026-10-20": 15_000_000n, "2026-10-21": 21_000_000n });
    expect(report.excludedAccounts).toEqual([{ name: "Canada acct", currency: "CAD" }]);
  });

  it("lists dates newest first and counts active/unmapped accounts", () => {
    expect(report.dates).toEqual(["2026-10-21", "2026-10-20"]);
    expect(report.activeAccountCount).toBe(5);
    expect(report.unmappedAccountCount).toBe(1);
    expect(report.priorTotalMicros).toBe(5_000_000n);
  });

  it("compares against the same-length window just before", () => {
    expect(priorWindow("2026-10-01", "2026-10-28")).toEqual({ from: "2026-09-03", to: "2026-09-30" });
  });
});

describe("independence from PPC/LSA", () => {
  const files = [
    "src/lib/reddit-ads.ts",
    "src/lib/reddit-ads-token.ts",
    "src/lib/reddit-sync.ts",
    "src/lib/queries-reddit.ts",
  ];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const routeFiles = [
    ...walk(join(process.cwd(), "src/app/api/reddit")),
    join(process.cwd(), "src/app/api/cron/reddit-ads-sync/route.ts"),
  ];

  it("Reddit data code never imports PPC/LSA sync, Google Ads or their queries", () => {
    for (const f of [...files.map((f) => join(process.cwd(), f)), ...routeFiles]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from ["'][^"']*(ppc-sync|lsa-sync|google-ads|queries-lsa|queries-call-quality|\/queries)["']/);
    }
  });
});
