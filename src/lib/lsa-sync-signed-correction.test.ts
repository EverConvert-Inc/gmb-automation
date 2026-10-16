import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal stateful fake of the db calls recomputeLsaCallrailDay makes.
// Drizzle where-clauses are opaque here, so call_signed_events reads are
// answered by call order: the first read is the candidate lookup (every
// row), the second is applyRedirectedInContributions' read (rows whose
// is_rollup_real is true) — the same filter the real query applies.
type EventRow = {
  callrailCallId: string;
  lsaClientId: string;
  signedAt: Date;
  isSignedCase: boolean | null;
  isRollupReal: boolean | null;
  channel: string | null;
  tagCategoryLabels: string[] | null;
};

const state = vi.hoisted(() => ({
  events: [] as EventRow[],
  eventReads: 0,
  updates: [] as Record<string, unknown>[],
  upserts: [] as Record<string, unknown>[],
}));

vi.mock("./db/client", () => ({
  db: {
    query: {
      lsaClients: {
        findFirst: async () => ({
          id: "client-1",
          callrailCompanyId: "COM1",
          signedCaseNameFilters: ["LSA"],
          gmbCallrailNameFilters: [],
        }),
      },
      lsaCallrailTagCategories: {
        findMany: async () => [{ label: "Signed", callrailTagName: "Signed", rollup: "real" }],
      },
      ppcClients: { findFirst: async () => undefined },
      callSignedEvents: {
        findMany: async () => {
          state.eventReads += 1;
          return state.eventReads === 1
            ? state.events.map((e) => ({ ...e }))
            : state.events.filter((e) => e.isRollupReal === true).map((e) => ({ ...e }));
        },
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
          // Single-event tests: the where always targets that one row.
          Object.assign(state.events[0], values);
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          state.upserts.push(values);
        },
      }),
    }),
  },
}));

vi.mock("./google-ads", () => ({}));

vi.mock("./callrail", () => ({
  pullTextMessagesForCompany: vi.fn(),
  pullCallsForCompany: vi.fn(async () => [
    {
      date: "2026-10-02",
      totalCalls: 1,
      signedCases: 1,
      firstTimeCalls: 1,
      tagCategoryBreakdown: { Signed: 1 },
      rollupCounts: { real: 1, junk: 0, unclassified: 0 },
      channelBreakdown: null,
      signedRealCandidates: [
        { callId: "CAL1", date: "2026-10-02", channel: null, tagCategoryLabels: ["Signed"] },
      ],
    },
  ]),
}));

import { recomputeLsaCallrailDay } from "./lsa-sync";

function seedEvent(isRollupReal: boolean | null) {
  state.events = [
    {
      callrailCallId: "CAL1",
      lsaClientId: "client-1",
      // 8:20pm ET on 10/02 — 00:20 UTC on 10/03, the window the old UTC
      // reading credited to the following day.
      signedAt: new Date("2026-10-03T00:20:00Z"),
      isSignedCase: true,
      isRollupReal,
      channel: null,
      tagCategoryLabels: ["Signed"],
    },
  ];
}

describe("true-sign-date correction — call tagged on its own Eastern day", () => {
  beforeEach(() => {
    state.eventReads = 0;
    state.updates = [];
    state.upserts = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("counts once when a stale is_rollup_real = true row (from the UTC era) targets its own date", async () => {
    seedEvent(true);
    await recomputeLsaCallrailDay("client-1", "2026-10-02");

    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]).toMatchObject({
      date: "2026-10-02",
      signedCases: 1,
      rollupBreakdown: { real: 1, junk: 0, unclassified: 0 },
      tagCategoryBreakdown: { Signed: 1 },
    });
    expect(state.updates).toEqual([{ isRollupReal: null }]);
    expect(state.events[0].isRollupReal).toBeNull();
    expect(state.events[0].isSignedCase).toBe(true);
  });

  it("leaves a same-day row with is_rollup_real = null untouched and counts it once", async () => {
    seedEvent(null);
    await recomputeLsaCallrailDay("client-1", "2026-10-02");

    expect(state.upserts[0]).toMatchObject({ date: "2026-10-02", signedCases: 1 });
    expect(state.updates).toEqual([]);
  });
});
