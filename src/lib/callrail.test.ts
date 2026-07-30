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
        // PPC tracker — now also checked against call_view (see the
        // cross-tracker reclassification test below), but doesn't match
        // either row here (time mismatch), so it stays PPC unchanged.
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

    // call-d untouched (checked against call_view, didn't match).
    expect(day.channelBreakdown?.PPC.totalCalls).toBe(1);
  });

  it("reclassifies a PPC-tracker call into PMax when it matches a call_view row — tracker naming doesn't gate PMax eligibility, only call_view cross-reference does", async () => {
    const calls: MockCall[] = [
      {
        // Confirmed real case: a call on a "PPC - Google Map" tracker
        // that Google Ads' call_view independently labels "Ad" source
        // for the same PMax campaign — a tracker-naming mistake, not a
        // real PPC click. Exact timestamp/duration match.
        id: "call-ppc-match",
        start_time: "2026-07-28T13:02:12-04:00",
        duration: 103,
        tags: [],
        source_name: "PPC - Google Map",
        first_call: true,
        customer_phone_number: "+19197718904",
      },
      {
        // Genuine PPC call — no call_view row anywhere near it, stays PPC.
        id: "call-ppc-nomatch",
        start_time: "2026-07-28T09:00:00-04:00",
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
        startCallDateTime: "2026-07-28 13:02:12",
        callDurationSeconds: 102,
        callerAreaCode: "919",
        campaignId: "1",
        campaignName: "Local PMAX | Phone Calls",
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

    expect(day.channelBreakdown?.PMax.totalCalls).toBe(1);
    expect(day.channelBreakdown?.PPC.totalCalls).toBe(1);
    expect(day.channelBreakdown?.GMB).toBeUndefined();
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

  it("unconsumedRows() reports only rows never claimed by any match, reflecting final state after all calls are processed", () => {
    const matcher = createGmbAdMatcher(callViewRows);
    expect(matcher.unconsumedRows()).toEqual(callViewRows); // nothing matched yet

    matcher.match("2026-07-28", "2026-07-28T14:10:05-04:00", 249, "+16787049350");
    expect(matcher.unconsumedRows()).toEqual([]); // the only row got consumed
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

describe("pullCallsForCompany — PMax call_view reconciliation", () => {
  beforeEach(() => {
    process.env.CALLRAIL_API_KEY = "test-key";
    process.env.CALLRAIL_ACCOUNT_ID = "AC1";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CALLRAIL_API_KEY;
    delete process.env.CALLRAIL_ACCOUNT_ID;
  });

  it("reports per-day callViewRows total/matched/unmatched on the PMax bucket, including a day with zero CallRail calls at all", async () => {
    const calls: MockCall[] = [
      {
        // Matches callViewRows[0] exactly — the only call in this fixture.
        id: "call-a",
        start_time: "2026-07-28T14:10:05-04:00",
        duration: 249,
        tags: [],
        source_name: "GMB - Raleigh",
        first_call: true,
        customer_phone_number: "+16787049350",
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockCallsResponse(calls)));

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
        // Same day, no CallRail call anywhere near it — stays unmatched.
        startCallDateTime: "2026-07-28 09:00:00",
        callDurationSeconds: 30,
        callerAreaCode: "404",
        campaignId: "2",
        campaignName: "Other Campaign",
        callTrackingDisplayLocation: "AD",
      },
      {
        // A day with a call_view row but ZERO CallRail calls at all —
        // must still surface as an unmatched row, not silently vanish.
        startCallDateTime: "2026-07-29 10:00:00",
        callDurationSeconds: 60,
        callerAreaCode: "555",
        campaignId: "3",
        campaignName: "Other Campaign",
        callTrackingDisplayLocation: "LANDING_PAGE",
      },
    ];

    const days = await pullCallsForCompany(
      "COMPANY1",
      "2026-07-28",
      "2026-07-29",
      "Signed",
      ["PPC"],
      TAG_CATEGORIES,
      ["GMB"],
      "PPC",
      callViewRows,
    );
    const byDate = new Map(days.map((d) => [d.date, d]));

    const day28 = byDate.get("2026-07-28");
    expect(day28?.channelBreakdown?.PMax.totalCalls).toBe(1); // call-a reclassified
    expect(day28?.channelBreakdown?.PMax.callViewRowsTotal).toBe(2);
    expect(day28?.channelBreakdown?.PMax.callViewRowsMatched).toBe(1);
    expect(day28?.channelBreakdown?.PMax.callViewRowsUnmatched).toBe(1);

    // A bucket exists for 07-29 even though CallRail returned no calls
    // that day at all — created purely to carry the unmatched call_view row.
    const day29 = byDate.get("2026-07-29");
    expect(day29?.totalCalls).toBe(0);
    expect(day29?.channelBreakdown?.PMax.totalCalls).toBe(0);
    expect(day29?.channelBreakdown?.PMax.callViewRowsTotal).toBe(1);
    expect(day29?.channelBreakdown?.PMax.callViewRowsMatched).toBe(0);
    expect(day29?.channelBreakdown?.PMax.callViewRowsUnmatched).toBe(1);
  });

  it("excludes call_view rows outside the requested [fromDate, toDate] window from the reconciliation counts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockCallsResponse([])));

    const callViewRows: CallViewRow[] = [
      {
        // Outside the requested window — pullCallViewRows pulls the most
        // recent rows unbounded by date, so this must not leak in.
        startCallDateTime: "2026-06-01 10:00:00",
        callDurationSeconds: 60,
        callerAreaCode: "555",
        campaignId: "1",
        campaignName: "Old Campaign",
        callTrackingDisplayLocation: "LANDING_PAGE",
      },
    ];

    const days = await pullCallsForCompany(
      "COMPANY1",
      "2026-07-28",
      "2026-07-29",
      "Signed",
      ["PPC"],
      TAG_CATEGORIES,
      ["GMB"],
      "PPC",
      callViewRows,
    );

    expect(days).toEqual([]);
  });
});
