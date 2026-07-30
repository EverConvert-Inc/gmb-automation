import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGmbAdMatcher, pullCallsForCompany } from "./callrail";
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
        callTrackingDisplayLocation: "AD",
      },
      {
        // Different time/area — present in the pool but shouldn't match
        // call-b (time mismatch) despite existing.
        startCallDateTime: "2026-07-28 09:00:00",
        callDurationSeconds: 30,
        callerAreaCode: "404",
        campaignId: "2",
        campaignName: "Other Campaign",
        callTrackingDisplayLocation: "AD",
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

describe("createGmbAdMatcher — diagnostic delta reporting", () => {
  const callViewRows: CallViewRow[] = [
    {
      startCallDateTime: "2026-07-28 14:10:05",
      callDurationSeconds: 249,
      callerAreaCode: "678",
      campaignId: "1",
      campaignName: "Local PMax Map | Calls",
      callTrackingDisplayLocation: "AD",
    },
  ];

  it("reports zero deltas for an exact match", () => {
    const matcher = createGmbAdMatcher(callViewRows);
    const result = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:05-04:00",
      249,
      "+16787049350",
    );
    expect(result.matched).toBe(true);
    expect(result.bestCandidate).toMatchObject({
      timeDeltaSeconds: 0,
      durationDeltaSeconds: 0,
      withinTolerance: true,
      alreadyConsumed: false,
    });
  });

  it("still matches near the tolerance edge, reporting the real deltas", () => {
    const matcher = createGmbAdMatcher(callViewRows);
    // 5s time delta (at the limit), 3s duration delta (at the limit).
    const result = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:10-04:00",
      252,
      "+16787049350",
    );
    expect(result.matched).toBe(true);
    expect(result.bestCandidate).toMatchObject({
      timeDeltaSeconds: 5,
      durationDeltaSeconds: 3,
      withinTolerance: true,
    });
  });

  it("reports a near-miss (outside tolerance) instead of a silent non-match", () => {
    const matcher = createGmbAdMatcher(callViewRows);
    // 8s time delta — outside the 5s tolerance.
    const result = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:13-04:00",
      249,
      "+16787049350",
    );
    expect(result.matched).toBe(false);
    expect(result.bestCandidate).toMatchObject({
      timeDeltaSeconds: 8,
      durationDeltaSeconds: 0,
      withinTolerance: false,
      alreadyConsumed: false,
    });
  });

  it("reports alreadyConsumed on the closest candidate when it was claimed by an earlier call", () => {
    const matcher = createGmbAdMatcher(callViewRows);
    const first = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:05-04:00",
      249,
      "+16787049350",
    );
    expect(first.matched).toBe(true);

    // Same area code, same date, close in time — but the only call_view
    // row for this area code is already consumed.
    const second = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:07-04:00",
      250,
      "+16787049350",
    );
    expect(second.matched).toBe(false);
    expect(second.bestCandidate).toMatchObject({
      alreadyConsumed: true,
      withinTolerance: true, // would have matched, if not for consumption
    });
  });
});

describe("createGmbAdMatcher — blank call_view area code fallback", () => {
  const blankAreaCodeRow: CallViewRow[] = [
    {
      startCallDateTime: "2026-07-28 14:10:05",
      callDurationSeconds: 249,
      callerAreaCode: "", // Google's UI shows "--" for these
      campaignId: "1",
      campaignName: "Local PMax Map | Calls",
      callTrackingDisplayLocation: "LANDING_PAGE",
    },
  ];

  it("matches within the tighter 2s time / 3s duration tolerance when call_view's area code is blank", () => {
    const matcher = createGmbAdMatcher(blankAreaCodeRow);
    const result = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:07-04:00", // 2s delta
      250, // 1s duration delta
      "+16787049350", // CallRail's own area code (678) — never checked against blank row
    );
    expect(result.matched).toBe(true);
    expect(result.bestCandidate).toMatchObject({
      timeDeltaSeconds: 2,
      durationDeltaSeconds: 1,
      withinTolerance: true,
      callViewAreaCodeAvailable: false,
    });
  });

  it("matches a blank-area-code row at 1-2s time delta / 2-3s duration delta (the confirmed real-world near-miss pattern from short/abandoned calls)", () => {
    const matcher = createGmbAdMatcher(blankAreaCodeRow);
    const result = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:06-04:00", // 1s time delta
      252, // 3s duration delta — was rejected under the old 1s duration tolerance
      "+16787049350",
    );
    expect(result.matched).toBe(true);
    expect(result.bestCandidate).toMatchObject({
      timeDeltaSeconds: 1,
      durationDeltaSeconds: 3,
      withinTolerance: true,
      callViewAreaCodeAvailable: false,
    });
  });

  it("does NOT match a blank-area-code row outside the tighter tolerance, even though it's within the normal 5s/3s window", () => {
    const matcher = createGmbAdMatcher(blankAreaCodeRow);
    const result = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:08-04:00", // 3s delta — inside 5s, outside the 2s no-area-code tolerance
      249,
      "+16787049350",
    );
    expect(result.matched).toBe(false);
    expect(result.bestCandidate).toMatchObject({
      timeDeltaSeconds: 3,
      withinTolerance: false,
      callViewAreaCodeAvailable: false,
    });
  });

  it("still excludes a call_view row with a real but DIFFERENT area code, regardless of proximity", () => {
    const matcher = createGmbAdMatcher([
      {
        startCallDateTime: "2026-07-28 14:10:05",
        callDurationSeconds: 249,
        callerAreaCode: "404", // real area code, but disagrees with the caller's 678
        campaignId: "1",
        campaignName: "Local PMax Map | Calls",
        callTrackingDisplayLocation: "AD",
      },
    ]);
    const result = matcher.match(
      "2026-07-28",
      "2026-07-28T14:10:05-04:00", // exact time/duration match otherwise
      249,
      "+16787049350", // area code 678
    );
    expect(result.matched).toBe(false);
    expect(result.bestCandidate).toBeUndefined();
  });
});
