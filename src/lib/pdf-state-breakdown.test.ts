import { describe, expect, it } from "vitest";
import { renderPpcReportPdf } from "./ppc-pdf";
import { renderLsaReportPdf } from "./lsa-pdf";
import { renderCallQualityReportPdf } from "./call-quality-pdf";
import type { PpcClientTotal, PpcReport, PpcReportRow, PpcStateRollup } from "./queries";
import type { LsaClientRow, LsaReport, LsaStateRollup } from "./queries-lsa";
import type {
  CallQualityByClientReport,
  CallQualityChannelTotals,
  CallQualityClientRow,
  CallQualityStateRollup,
} from "./queries-call-quality";
import type { StateGroup } from "./report-grouping";

// These call the real react-pdf renderer (renderToBuffer), not just
// typecheck — a broken <View>/<Text> nesting or bad style key throws at
// render time, not compile time, and there's no way to eyeball a PDF in
// this environment. A non-trivial "%PDF" buffer is the cheapest real
// signal that the document actually rendered.
function assertLooksLikePdf(buf: Buffer) {
  expect(buf.length).toBeGreaterThan(500);
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
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

function ppcGroup(state: string, clients: PpcClientTotal[]): StateGroup<PpcClientTotal, PpcStateRollup> {
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

function ppcReportRow(overrides: Partial<PpcReportRow> = {}): PpcReportRow {
  return {
    ppcClientId: "c1",
    ppcClientName: "Acme Law",
    campaignId: "camp1",
    campaignName: "Search - Brand",
    clicks: 50,
    impressions: 500,
    conversions: 6,
    phoneCalls: 20,
    costMicros: 250_000_000n,
    signedCases: 4,
    ...overrides,
  };
}

describe("renderPpcReportPdf", () => {
  it("renders a valid PDF with multiple state sections and per-campaign nesting", async () => {
    const clientA = ppcClient({ ppcClientId: "a", state: "GA" });
    const clientB = ppcClient({ ppcClientId: "b", ppcClientName: "Beta & <Law>", state: "TX", signedCases: null });
    const report: PpcReport = {
      kpis: { clicks: 150, impressions: 1500, conversions: 18, phoneCalls: 60, costMicros: 750_000_000n, signedCases: 8 },
      kpisPrior: { clicks: 100, impressions: 1000, conversions: 12, phoneCalls: 40, costMicros: 500_000_000n, signedCases: 5 },
      rows: [ppcReportRow({ ppcClientId: "a" }), ppcReportRow({ ppcClientId: "b", campaignId: "camp2" })],
      clientTotals: [clientA, clientB],
      stateGroups: [ppcGroup("GA", [clientA]), ppcGroup("TX", [clientB])],
    };
    const buf = await renderPpcReportPdf(report, { from: "2026-09-01", to: "2026-09-16" });
    assertLooksLikePdf(buf);
  });

  it("renders the empty-state message when there are no clients", async () => {
    const report: PpcReport = {
      kpis: { clicks: 0, impressions: 0, conversions: 0, phoneCalls: 0, costMicros: 0n, signedCases: 0 },
      kpisPrior: { clicks: 0, impressions: 0, conversions: 0, phoneCalls: 0, costMicros: 0n, signedCases: 0 },
      rows: [],
      clientTotals: [],
      stateGroups: [],
    };
    const buf = await renderPpcReportPdf(report, { from: "2026-09-01", to: "2026-09-16" });
    assertLooksLikePdf(buf);
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

function lsaGroup(state: string, clients: LsaClientRow[]): StateGroup<LsaClientRow, LsaStateRollup> {
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

describe("renderLsaReportPdf", () => {
  it("renders a valid PDF with multiple state sections", async () => {
    const clientA = lsaClient({ lsaClientId: "a", state: "NC" });
    const clientB = lsaClient({ lsaClientId: "b", state: "SC", googleAdsCustomerId: null });
    const report: LsaReport = {
      kpis: { phoneCallCount: 60, messageCount: 10, bookingCount: 4, costMicros: 600_000_000n, signedCases: 8 },
      kpisPrior: { phoneCallCount: 40, messageCount: 8, bookingCount: 3, costMicros: 400_000_000n, signedCases: 5 },
      rows: [clientA, clientB],
      stateGroups: [lsaGroup("NC", [clientA]), lsaGroup("SC", [clientB])],
    };
    const buf = await renderLsaReportPdf(report, { from: "2026-09-01", to: "2026-09-16" });
    assertLooksLikePdf(buf);
  });

  it("renders the empty-state message when there are no clients", async () => {
    const report: LsaReport = {
      kpis: { phoneCallCount: 0, messageCount: 0, bookingCount: 0, costMicros: 0n, signedCases: 0 },
      kpisPrior: { phoneCallCount: 0, messageCount: 0, bookingCount: 0, costMicros: 0n, signedCases: 0 },
      rows: [],
      stateGroups: [],
    };
    const buf = await renderLsaReportPdf(report, { from: "2026-09-01", to: "2026-09-16" });
    assertLooksLikePdf(buf);
  });
});

function cqClientRow(overrides: Partial<CallQualityClientRow> = {}): CallQualityClientRow {
  return {
    clientId: "c1",
    clientName: "Gamma Legal",
    channel: "PPC",
    state: "GA",
    firstTimeCalls: 10,
    tagCounts: {},
    real: 6,
    junk: 2,
    unclassified: 1,
    costMicros: 200_000_000n,
    realCostPerRealLead: 33.3,
    adsReportedCpa: 40,
    callViewRowsTotal: 0,
    callViewRowsMatched: 0,
    callViewRowsUnmatched: 0,
    ...overrides,
  };
}

function cqTotals(overrides: Partial<CallQualityChannelTotals> = {}): CallQualityChannelTotals {
  return {
    channel: "PPC",
    firstTimeCalls: 10,
    tagCounts: {},
    real: 6,
    junk: 2,
    unclassified: 1,
    costMicros: 200_000_000n,
    realCostPerRealLead: 33.3,
    adsReportedCpa: 40,
    callViewRowsTotal: 0,
    callViewRowsMatched: 0,
    callViewRowsUnmatched: 0,
    ...overrides,
  };
}

function cqGroup(
  state: string,
  clients: CallQualityClientRow[],
): StateGroup<CallQualityClientRow, CallQualityStateRollup> {
  return {
    state: state as StateGroup<CallQualityClientRow, CallQualityStateRollup>["state"],
    clients,
    rollup: {
      firstTimeCalls: clients.reduce((s, c) => s + c.firstTimeCalls, 0),
      real: clients.reduce((s, c) => s + c.real, 0),
      junk: clients.reduce((s, c) => s + c.junk, 0),
      unclassified: clients.reduce((s, c) => s + c.unclassified, 0),
      costMicros: clients.reduce((s, c) => s + c.costMicros, 0n),
      realCostPerRealLead: 33.3,
    },
  };
}

describe("renderCallQualityReportPdf", () => {
  it("renders a valid PDF with the state breakdown for all four channels", async () => {
    const ppcClientA = cqClientRow({ clientId: "p1", channel: "PPC", state: "GA" });
    const pmaxClientA = cqClientRow({ clientId: "m1", channel: "PMax", state: "TX", callViewRowsTotal: 5, callViewRowsMatched: 4, callViewRowsUnmatched: 1 });
    const lsaClientA = cqClientRow({ clientId: "l1", channel: "LSA", state: "NC" });
    const gmbClientA = cqClientRow({ clientId: "g1", channel: "GMB", state: "SC" });

    const report: CallQualityByClientReport = {
      clients: { PPC: [ppcClientA], LSA: [lsaClientA], GMB: [gmbClientA], PMax: [pmaxClientA] },
      summary: {
        PPC: cqTotals({ channel: "PPC" }),
        LSA: cqTotals({ channel: "LSA" }),
        GMB: cqTotals({ channel: "GMB", costMicros: 0n, realCostPerRealLead: null, adsReportedCpa: null }),
        PMax: cqTotals({ channel: "PMax", costMicros: 0n, realCostPerRealLead: null, adsReportedCpa: null }),
      },
      stateGroups: {
        PPC: [cqGroup("GA", [ppcClientA])],
        LSA: [cqGroup("NC", [lsaClientA])],
        GMB: [cqGroup("SC", [gmbClientA])],
        PMax: [cqGroup("TX", [pmaxClientA])],
      },
    };
    const buf = await renderCallQualityReportPdf(report, { from: "2026-09-01", to: "2026-09-16" });
    assertLooksLikePdf(buf);
  });

  it("renders fine when every channel's state breakdown is empty", async () => {
    const report: CallQualityByClientReport = {
      clients: { PPC: [], LSA: [], GMB: [], PMax: [] },
      summary: {
        PPC: cqTotals({ channel: "PPC", firstTimeCalls: 0, real: 0, junk: 0, unclassified: 0, costMicros: 0n, realCostPerRealLead: null, adsReportedCpa: null }),
        LSA: cqTotals({ channel: "LSA", firstTimeCalls: 0, real: 0, junk: 0, unclassified: 0, costMicros: 0n, realCostPerRealLead: null, adsReportedCpa: null }),
        GMB: cqTotals({ channel: "GMB", firstTimeCalls: 0, real: 0, junk: 0, unclassified: 0, costMicros: 0n, realCostPerRealLead: null, adsReportedCpa: null }),
        PMax: cqTotals({ channel: "PMax", firstTimeCalls: 0, real: 0, junk: 0, unclassified: 0, costMicros: 0n, realCostPerRealLead: null, adsReportedCpa: null }),
      },
      stateGroups: { PPC: [], LSA: [], GMB: [], PMax: [] },
    };
    const buf = await renderCallQualityReportPdf(report, { from: "2026-09-01", to: "2026-09-16" });
    assertLooksLikePdf(buf);
  });
});
