import { describe, expect, it } from "vitest";
import { buildRedditReport, type RedditReportAccount } from "./queries-reddit";
import { renderRedditEmailHtml, renderRedditEmailText } from "./reddit-email";
import { redditDailyColumns, renderRedditReportPdf } from "./reddit-pdf";

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

const report = buildRedditReport({
  from: "2026-11-01",
  to: "2026-11-02",
  priorTotalMicros: 10_000_000n,
  accounts: [
    account({ id: "a1", name: "Smith & Jones", redditClientId: "c1", redditClientName: "Smith & Jones <Law>" }),
    account({ id: "a2", name: "Loose", lastSyncError: "HTTP 500" }),
    account({ id: "a3", name: "Maple", currency: "CAD", redditClientId: "c2", redditClientName: "Maple" }),
  ],
  rows: [
    { adAccountId: "a1", date: "2026-11-01", spendMicros: 12_340_000n },
    { adAccountId: "a2", date: "2026-11-02", spendMicros: 1_000_000n },
    { adAccountId: "a3", date: "2026-11-02", spendMicros: 99_000_000n },
  ],
});

function assertBalancedTags(html: string, tag: string) {
  const open = (html.match(new RegExp(`<${tag}(\\s|>)`, "g")) ?? []).length;
  const close = (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
  expect(open, tag).toBe(close);
}

describe("Reddit email body", () => {
  const html = renderRedditEmailHtml(report, "https://app.example");
  const text = renderRedditEmailText(report, "https://app.example");

  it("shows the USD total and per-client spend, never the non-USD spend", () => {
    expect(html).toContain("$13.34");
    expect(html).toContain("$12.34");
    expect(html).not.toContain("$99.00");
    expect(text).toContain("$13.34");
    expect(text).not.toContain("$99.00");
  });

  it("calls out excluded, failing and unmapped accounts in both bodies", () => {
    for (const body of [html, text]) {
      expect(body).toContain("Maple (CAD)");
      expect(body).toContain("spend may be incomplete: Loose");
      expect(body).toContain("1 ad account isn't mapped");
    }
  });

  it("escapes client names and keeps the markup balanced", () => {
    expect(html).toContain("Smith &amp; Jones &lt;Law&gt;");
    for (const tag of ["table", "tr", "td", "div", "a"]) assertBalancedTags(html, tag);
  });

  it("compares against the prior period and links back to the app", () => {
    expect(text).toContain("+$3.34 vs prior period");
    expect(html).toContain('href="https://app.example/reddit"');
    expect(html).toContain('href="https://app.example/settings"');
  });
});

describe("Reddit PDF", () => {
  it("renders a real PDF", async () => {
    const buf = await renderRedditReportPdf(report, { generatedAt: new Date("2026-11-03T12:00:00Z") });
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("folds clients past the seventh into one column, keeping Unmapped separate", () => {
    const many = buildRedditReport({
      from: "2026-11-01",
      to: "2026-11-01",
      priorTotalMicros: 0n,
      accounts: [
        ...Array.from({ length: 10 }, (_, i) =>
          account({ id: `a${i}`, name: `C${i}`, redditClientId: `c${i}`, redditClientName: `C${i}` }),
        ),
        account({ id: "u", name: "Loose" }),
      ],
      rows: Array.from({ length: 10 }, (_, i) => ({
        adAccountId: `a${i}`,
        date: "2026-11-01",
        spendMicros: BigInt((10 - i) * 1_000_000),
      })),
    });
    const cols = redditDailyColumns(many.clients);
    expect(cols.map((c) => c.label)).toEqual(["C0", "C1", "C2", "C3", "C4", "C5", "C6", "Other clients (3)", "Unmapped"]);
    const covered = cols.flatMap((c) => c.members.map((m) => m.key));
    expect(new Set(covered).size).toBe(many.clients.length);
  });

  it("doesn't fold when one extra client would just become an 'Other' of one", () => {
    const clients = Array.from({ length: 8 }, (_, i) => ({
      key: `c${i}`,
      name: `C${i}`,
      accountCount: 1,
      totalMicros: 0n,
      byDate: {},
    }));
    expect(redditDailyColumns(clients)).toHaveLength(8);
  });
});
