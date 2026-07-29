import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pullCallsForCompany } from "./callrail";
import type { CallViewRow } from "./google-ads";

type MockCall = {
  id: string;
  start_time: string;
  duration: number | null;
  tags: string[];
  source_name?: string | null;
  first_call?: boolean | null;
  customer_phone_number?: string | null;
};

function mockCallsResponse(calls: MockCall[]) {
  return {
    ok: true,
    json: async () => ({ calls, total_pages: 1 }),
    text: async () => "",
  };
}

const TAG_CATEGORIES = [
  { label: "Signed", callrailTagName: "Signed", rollup: "real" as const },
];

describe("pullCallsForCompany — GMB/PMax reclassification", () => {
  beforeEach(() => {
    process.env.CALLRAIL_API_KEY = "test-key";
    process.env.CALLRAIL_ACCOUNT_ID = "AC1"; // skip the accounts.json lookup
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CALLRAIL_API_KEY;
    delete process.env.CALLRAIL_ACCOUNT_ID;
  });

  it("reclassifies a call_view-matched GMB-tracker call into PMax (with full tag/rollup structure), leaves an unmatched one in GMB, never double-consumes a call_view row, and leaves PPC untouched", async () => {
    const calls: MockCall[] = [
      {
        // Exact match — same shape as the real confirmed Hodgins & Kiber
        // call. Tagged "Signed" to prove PMax gets the full
        // tagCategoryBreakdown/rollupCounts treatment, not a stripped one.
        id: "call-a",
        start_time: "2026-07-28T14:10:05-04:00",
        duration: 249,
        tags: ["Signed"],
        source_name: "GMB - Raleigh",
        first_call: true,
        customer_phone_number: "+16787049350",
      },
      {
        // Different area code — no call_view row matches → stays GMB (organic).
        id: "call-b",
        start_time: "2026-07-28T15:00:00-04:00",
        duration: 60,
        tags: [],
        source_name: "GMB - Raleigh",
        first_call: true,
        customer_phone_number: "+14045551234",
      },
      {
        // Same area code as call-a and within tolerance of its call_view
        // row, but call-a already consumed the only 678-area row — must
        // NOT double-match into PMax, falls back to GMB (organic).
        id: "call-c",
        start_time: "2026-07-28T14:10:07-04:00",
        duration: 250,
        tags: [],
        source_name: "GMB - Raleigh",
        first_call: true,
        customer_phone_number: "+16787049350",
      },
      {
        // Non-GMB tracker entirely — untouched by GMB/PMax reclassification.
        id: "call-d",
        start_time: "2026-07-28T16:00:00-04:00",
        duration: 30,
        tags: [],
        source_name: "PPC - Brand",
        first_call: true,
        customer_phone_number: "+16787049350",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockCallsResponse(calls)),
    );

    const callViewRows: CallViewRow[] = [
      {
        startCallDateTime: "2026-07-28 14:10:05",
        callDurationSeconds: 249,
        callerAreaCode: "678",
        campaignId: "1",
        campaignName: "Local PMax Map | Calls",
      },
      {
        // Different time/area — present in the pool but shouldn't match
        // call-b (time mismatch) despite existing.
        startCallDateTime: "2026-07-28 09:00:00",
        callDurationSeconds: 30,
        callerAreaCode: "404",
        campaignId: "2",
        campaignName: "Other Campaign",
      },
    ];

    const [day] = await pullCallsForCompany(
      "COMPANY1",
      "2026-07-28",
      "2026-07-28",
      "Signed",
      ["PPC"],
      TAG_CATEGORIES,
      ["GMB"],
      "PPC",
      callViewRows,
    );

    // call-a moved entirely into PMax, not counted in GMB at all.
    expect(day.channelBreakdown?.PMax.totalCalls).toBe(1);
    expect(day.channelBreakdown?.PMax.firstTimeCalls).toBe(1);
    expect(day.channelBreakdown?.PMax.tagCategoryBreakdown).toEqual({ Signed: 1 });
    expect(day.channelBreakdown?.PMax.rollupCounts).toEqual({
      real: 1,
      junk: 0,
      unclassified: 0,
    });

    // call-b (area mismatch) + call-c (pool exhausted) stay organic GMB.
    expect(day.channelBreakdown?.GMB.totalCalls).toBe(2);

    // call-d untouched.
    expect(day.channelBreakdown?.PPC.totalCalls).toBe(1);
  });

  it("leaves every GMB-tracker call in GMB (no PMax key at all) when callViewRows is omitted", async () => {
    const calls: MockCall[] = [
      {
        id: "call-a",
        start_time: "2026-07-28T14:10:05-04:00",
        duration: 249,
        tags: [],
        source_name: "GMB - Raleigh",
        first_call: true,
        customer_phone_number: "+16787049350",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockCallsResponse(calls)),
    );

    const [day] = await pullCallsForCompany(
      "COMPANY1",
      "2026-07-28",
      "2026-07-28",
      "Signed",
      ["PPC"],
      [],
      ["GMB"],
      "PPC",
      undefined,
    );

    expect(day.channelBreakdown?.GMB.totalCalls).toBe(1);
    expect(day.channelBreakdown?.PMax).toBeUndefined();
  });
});
