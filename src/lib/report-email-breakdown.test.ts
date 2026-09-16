import { describe, expect, it } from "vitest";
import { renderStateBreakdownHtml as renderPpcHtml, renderStateBreakdownText as renderPpcText } from "./ppc-email";
import { renderStateBreakdownHtml as renderLsaHtml, renderStateBreakdownText as renderLsaText } from "./lsa-email";
import type { PpcClientTotal, PpcStateRollup } from "./queries";
import type { LsaClientRow, LsaStateRollup } from "./queries-lsa";
import type { StateGroup } from "./report-grouping";

// Counts of open vs close tags must match — the cheapest real signal that a
// template literal didn't drop/duplicate a closing tag somewhere.
function assertBalancedTags(html: string, tag: string) {
  const openCount = (html.match(new RegExp(`<${tag}(\\s|>)`, "g")) ?? []).length;
  const closeCount = (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
  expect(openCount).toBe(closeCount);
}

function ppcClient(overrides: Partial<PpcClientTotal> = {}): PpcClientTotal {
  return {
    ppcClientId: "c1",
    ppcClientName: "Acme Law",
    state: "GA",
    googleAdsCustomerId: "1234567890",
    clicks: 100,
    impressions: 1000,
    conversions: 12,
    phoneCalls: 40,
    costMicros: 500_000_000n,
    signedCases: 8,
    ...overrides,
  };
}

function ppcGroup(
  state: string,
  clients: PpcClientTotal[],
): StateGroup<PpcClientTotal, PpcStateRollup> {
  return {
    state: state as StateGroup<PpcClientTotal, PpcStateRollup>["state"],
    clients,
    rollup: {
      clicks: clients.reduce((s, c) => s + c.clicks, 0),
      impressions: clients.reduce((s, c) => s + c.impressions, 0),
      conversions: clients.reduce((s, c) => s + c.conversions, 0),
      phoneCalls: clients.reduce((s, c) => s + c.phoneCalls, 0),
      costMicros: clients.reduce((s, c) => s + c.costMicros, 0n),
      signedCases: clients.reduce((s, c) => s + (c.signedCases ?? 0), 0),
      costPerSignedCase: 62.5,
    },
  };
}

describe("ppc-email renderStateBreakdownHtml", () => {
  it("returns empty string for no groups", () => {
    expect(renderPpcHtml([])).toBe("");
  });

  it("renders the full state name, code, KPI strip, and one row per client", () => {
    const html = renderPpcHtml([ppcGroup("GA", [ppcClient()])]);
    expect(html).toContain("Georgia (GA)");
    expect(html).toContain("Acme Law");
    expect(html).toContain("7890"); // last 4 of the Ads ID
    expect(html).toContain("Clicks 100");
    expect(html).toContain("Signed 8");
  });

  it("renders Unassigned with no parenthetical code", () => {
    const html = renderPpcHtml([ppcGroup("Unassigned", [ppcClient({ state: null })])]);
    expect(html).toContain("Unassigned");
    expect(html).not.toContain("(Unassigned)");
  });

  it("shows an em dash for a client not linked to CallRail", () => {
    const html = renderPpcHtml([ppcGroup("GA", [ppcClient({ signedCases: null })])]);
    expect(html).toContain("—");
  });

  it("escapes a client name containing HTML-significant characters", () => {
    const html = renderPpcHtml([ppcGroup("GA", [ppcClient({ ppcClientName: "A & B <Law>" })])]);
    expect(html).toContain("A &amp; B &lt;Law&gt;");
    expect(html).not.toContain("<Law>");
  });

  // googleAdsCustomerId is free text (the admin form only strips dashes,
  // no digit-only validation), so its last-4-digits rendering must be
  // escaped too, same as the client name — unlike the web table (React
  // JSX auto-escapes), this is a raw HTML string template.
  it("escapes an Ads ID whose last 4 characters are HTML-significant", () => {
    const html = renderPpcHtml([
      ppcGroup("GA", [ppcClient({ googleAdsCustomerId: "12345<b>" })]),
    ]);
    expect(html).toContain("5&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("keeps table/tr/td/th tags balanced across multiple sections and clients", () => {
    const html = renderPpcHtml([
      ppcGroup("GA", [ppcClient({ ppcClientId: "a" }), ppcClient({ ppcClientId: "b" })]),
      ppcGroup("TX", [ppcClient({ ppcClientId: "c" })]),
    ]);
    assertBalancedTags(html, "table");
    assertBalancedTags(html, "tr");
    assertBalancedTags(html, "td");
    assertBalancedTags(html, "th");
    assertBalancedTags(html, "div");
  });
});

describe("ppc-email renderStateBreakdownText", () => {
  it("returns empty string for no groups", () => {
    expect(renderPpcText([])).toBe("");
  });

  it("includes the state header line and a per-client line", () => {
    const text = renderPpcText([ppcGroup("GA", [ppcClient()])]);
    expect(text).toContain("Georgia (GA)");
    expect(text).toContain("Acme Law");
  });
});

function lsaClient(overrides: Partial<LsaClientRow> = {}): LsaClientRow {
  return {
    lsaClientId: "c1",
    lsaClientName: "Beta Firm",
    state: "NC",
    googleAdsCustomerId: "9998887777",
    phoneCallCount: 30,
    messageCount: 5,
    bookingCount: 2,
    costMicros: 300_000_000n,
    signedCases: 4,
    ...overrides,
  };
}

function lsaGroup(
  state: string,
  clients: LsaClientRow[],
): StateGroup<LsaClientRow, LsaStateRollup> {
  return {
    state: state as StateGroup<LsaClientRow, LsaStateRollup>["state"],
    clients,
    rollup: {
      phoneCallCount: clients.reduce((s, c) => s + c.phoneCallCount, 0),
      messageCount: clients.reduce((s, c) => s + c.messageCount, 0),
      bookingCount: clients.reduce((s, c) => s + c.bookingCount, 0),
      costMicros: clients.reduce((s, c) => s + c.costMicros, 0n),
      signedCases: clients.reduce((s, c) => s + c.signedCases, 0),
      costPerSignedCase: 75,
    },
  };
}

describe("lsa-email renderStateBreakdownHtml", () => {
  it("returns empty string for no groups", () => {
    expect(renderLsaHtml([])).toBe("");
  });

  it("renders the full state name, code, KPI strip, and one row per client", () => {
    const html = renderLsaHtml([lsaGroup("NC", [lsaClient()])]);
    expect(html).toContain("North Carolina (NC)");
    expect(html).toContain("Beta Firm");
    expect(html).toContain("7777"); // last 4 of the Ads ID
    expect(html).toContain("Messages 5");
  });

  it("keeps table/tr/td/th tags balanced", () => {
    const html = renderLsaHtml([
      lsaGroup("NC", [lsaClient({ lsaClientId: "a" }), lsaClient({ lsaClientId: "b" })]),
      lsaGroup("SC", [lsaClient({ lsaClientId: "c" })]),
    ]);
    assertBalancedTags(html, "table");
    assertBalancedTags(html, "tr");
    assertBalancedTags(html, "td");
    assertBalancedTags(html, "th");
  });

  it("escapes an Ads ID whose last 4 characters are HTML-significant", () => {
    const html = renderLsaHtml([
      lsaGroup("NC", [lsaClient({ googleAdsCustomerId: "12345<b>" })]),
    ]);
    expect(html).toContain("5&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("lsa-email renderStateBreakdownText", () => {
  it("includes the state header line and a per-client line", () => {
    const text = renderLsaText([lsaGroup("NC", [lsaClient()])]);
    expect(text).toContain("North Carolina (NC)");
    expect(text).toContain("Beta Firm");
  });
});
