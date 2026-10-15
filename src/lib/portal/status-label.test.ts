// The portal's status label, verified from the CallRail record through the
// REAL sync planner (planLeadWrites) to the label — so these tests also pin
// down where a multi-person note's per-person status ends up in the row.
import { describe, expect, it } from "vitest";
import { normalizeCall, planLeadWrites } from "@/lib/leads/sync";
import { buildRoutingIndex } from "@/lib/leads/routing";
import type { PlannedLead } from "@/lib/leads/types";
import { PORTAL_STATUS_TEXT, portalStatusLabel, type StatusLabelInput } from "./visibility";

const NOW = new Date("2026-10-14T15:00:00Z");
const index = buildRoutingIndex([], [{ firmId: "firm-a", callrailCompanyId: "COM1" }]);

function plan(tags: string[], note: string): PlannedLead[] {
  const call = {
    id: "c1",
    start_time: "2026-10-05T14:30:00.000-04:00",
    customer_name: "Fallback Name",
    customer_phone_number: "555-000-1111",
    source_name: "PPC - Main",
    tracker_id: "TRK1",
    tags,
    note,
  };
  return planLeadWrites([normalizeCall(call as never, "COM1")!], index, { now: NOW });
}

/** The label a freshly synced row gets, with an optional admin override. */
function labelOf(row: PlannedLead, statusOverride: "signed" | "pending" | null = null) {
  return portalStatusLabel({
    effectiveStatus: statusOverride ?? row.statusParsed,
    hasStatusOverride: statusOverride !== null,
    statusTagMatched: row.statusTagMatched,
  });
}

describe("where a multi-person note's per-person status is stored", () => {
  it("in BOTH status_parsed and status_tag_matched, replacing the call's tags for that person", () => {
    const [jane, john] = plan(["2 Person", "Pending"], "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444, Pending");
    expect([jane.statusParsed, jane.statusTagMatched]).toEqual(["signed", "Signed"]);
    expect([john.statusParsed, john.statusTagMatched]).toEqual(["pending", "Pending"]);
  });

  it("a person with no status text of their own falls back to the call's tags", () => {
    const [, john] = plan(["2 Person", "Pending"], "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444");
    expect([john.statusParsed, john.statusTagMatched]).toEqual(["pending", "Pending"]);
  });

  it("a single-person note's trailing status word is NOT stored — the tags decide", () => {
    const [row] = plan(["Opportunity"], "Jane Doe, 555-111-2222, Pending");
    expect([row.statusParsed, row.statusTagMatched]).toEqual(["pending", null]);
  });
});

describe("portal status label", () => {
  it("Signed: a Signed tag", () => {
    const [row] = plan(["Signed"], "Jane Doe, 555-123-4567");
    expect(labelOf(row)).toBe("signed");
  });

  it("Pending via tag", () => {
    const [row] = plan(["Pending", "Opportunity"], "Jane Doe, 555-123-4567");
    expect(labelOf(row)).toBe("pending");
  });

  it("Pending via the person's own status in a multi-person note (call tags say nothing)", () => {
    const [, john] = plan(["2 Person", "Opportunity"], "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444, Pending");
    expect(labelOf(john)).toBe("pending");
  });

  it("Opportunity-only: the Opportunity flag with no status tag and no note status", () => {
    const [row] = plan(["Opportunity"], "Jane Doe, 555-123-4567");
    expect(row.statusParsed).toBe("pending"); // the default, not a real Pending
    expect(row.statusTagMatched).toBeNull();
    expect(labelOf(row)).toBe("opportunity");
  });

  it("status_parsed's default 'pending' alone is never labelled Pending", () => {
    expect(
      portalStatusLabel({ effectiveStatus: "pending", hasStatusOverride: false, statusTagMatched: null }),
    ).toBe("opportunity");
  });

  describe("a multi-person lead with mixed statuses", () => {
    it("call tagged Pending, one person's note says Signed → that person is Signed, the other Pending", () => {
      const rows = plan(["2 Person", "Pending"], "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444, Pending");
      expect(rows.map((r) => labelOf(r))).toEqual(["signed", "pending"]);
    });

    it("the reverse: call tagged Signed, one person's note says Pending → that person is Pending", () => {
      const rows = plan(["2 Person", "Signed"], "Jane Doe, 555-111-2222, Pending; John Roe, 555-333-4444, Signed");
      expect(rows.map((r) => labelOf(r))).toEqual(["pending", "signed"]);
      expect(rows[0].signedAt).toBeNull(); // not treated as signed anywhere
    });

    it("three people: Signed, Pending, and one with no status text who takes the call's tag", () => {
      const rows = plan(
        ["3 Person", "Opportunity"],
        "Jane Doe, 555-111-2222, Signed; John Roe, 555-333-4444, Pending; Ann Poe, 555-555-6666",
      );
      expect(rows.map((r) => labelOf(r))).toEqual(["signed", "pending", "opportunity"]);
    });
  });

  describe("an admin override", () => {
    it("override signed beats a Pending tag", () => {
      const [row] = plan(["Pending", "Opportunity"], "Jane Doe, 555-123-4567");
      expect(labelOf(row, "signed")).toBe("signed");
    });

    it("override pending beats a Signed tag, and is a real Pending", () => {
      const [row] = plan(["Signed"], "Jane Doe, 555-123-4567");
      expect(labelOf(row, "pending")).toBe("pending");
    });

    it("override pending on an Opportunity-only lead is Pending (an explicit choice, not the default)", () => {
      const [row] = plan(["Opportunity"], "Jane Doe, 555-123-4567");
      expect(labelOf(row, "pending")).toBe("pending");
    });
  });

  it("only three labels exist today, each with display text", () => {
    expect(PORTAL_STATUS_TEXT).toEqual({ signed: "Signed", pending: "Pending", opportunity: "Opportunity" });
    const all: StatusLabelInput[] = [
      { effectiveStatus: "signed", hasStatusOverride: false, statusTagMatched: "Lost" },
      { effectiveStatus: "pending", hasStatusOverride: false, statusTagMatched: "Lost" },
      { effectiveStatus: "pending", hasStatusOverride: false, statusTagMatched: "Declined" },
    ];
    // Lost / Declined are not labels yet (and are hidden by visibility anyway).
    expect(all.map(portalStatusLabel)).toEqual(["signed", "opportunity", "opportunity"]);
  });
});
