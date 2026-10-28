import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildRedditReport, type RedditReportAccount } from "@/lib/queries-reddit";
import { RedditDailySpendChart, redditChartSeries } from "./reddit-daily-spend-chart";

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

const clientNames = ["Weinstein", "1Georgia", "Atlanta Metro", "Harmon Groves", "Bravo", "Charlie", "Delta", "Echo", "Zulu"];

function report(spendByClient: Record<string, number>, to = "2026-10-21") {
  const accounts = [
    ...clientNames.map((n, i) => account({ id: `a${i}`, name: n, redditClientId: `c${i}`, redditClientName: n })),
    account({ id: "u", name: "Loose account" }),
  ];
  const rows = Object.entries(spendByClient).map(([name, dollars]) => ({
    adAccountId: name === "Unmapped" ? "u" : `a${clientNames.indexOf(name)}`,
    date: "2026-10-20",
    spendMicros: BigInt(dollars * 1_000_000),
  }));
  return buildRedditReport({ from: "2026-10-20", to, accounts, rows, priorTotalMicros: 0n });
}

describe("redditChartSeries", () => {
  it("gives clients slots alphabetically, so colours don't follow spend rank", () => {
    const low = redditChartSeries(report({ Weinstein: 1, "1Georgia": 500 }));
    const high = redditChartSeries(report({ Weinstein: 900, "1Georgia": 2 }));
    const colours = (r: ReturnType<typeof redditChartSeries>) =>
      Object.fromEntries(r.series.map((s) => [s.label, s.colorClass]));
    expect(colours(low)).toEqual(colours(high));
    expect(low.series[0].label).toBe("1Georgia");
  });

  it("folds clients past the eighth and Unmapped into one neutral series on top", () => {
    const { series } = redditChartSeries(report({ Zulu: 7, Unmapped: 3 }));
    expect(series).toHaveLength(9);
    const last = series[8];
    expect(last.label).toBe("Other clients + unmapped");
    expect(last.colorClass).toBe("bg-[#4a4945] dark:bg-[#b5b4ac]");
    expect(last.totalMicros).toBe(10_000_000n);
    expect(series.map((s) => s.label)).not.toContain("Zulu");
  });

  it("lays days out oldest to newest", () => {
    const { dates, series } = redditChartSeries(report({ Weinstein: 12.5 }));
    expect(dates).toEqual(["2026-10-20", "2026-10-21"]);
    expect(series.find((s) => s.label === "Weinstein")?.values).toEqual([12.5, 0]);
  });
});

describe("RedditDailySpendChart", () => {
  it("renders one stacked segment per client with spend that day, and no NaN geometry", () => {
    const html = renderToStaticMarkup(
      createElement(RedditDailySpendChart, { report: report({ Weinstein: 100, "1Georgia": 50, Unmapped: 25 }) }),
    );
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html.match(/flex:\s*\d+(\.\d+)? 1 0px/g)).toHaveLength(3);
    expect(html).toContain("$175.00");
  });

  it("says so instead of drawing an empty chart", () => {
    const html = renderToStaticMarkup(createElement(RedditDailySpendChart, { report: report({}) }));
    expect(html).toContain("No spend in this range.");
  });
});
