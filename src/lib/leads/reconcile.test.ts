import { describe, expect, it } from "vitest";
import {
  QUEUE_REASON_LABELS,
  queueReason,
  reconcileLeadRows,
  type ExistingLeadRow,
} from "./reconcile";
import type { PlannedLead } from "./types";

const NOW = new Date("2026-10-14T15:00:00Z");

function planned(firmId: string | null, over: Partial<PlannedLead> = {}): PlannedLead {
  return {
    firmId,
    source: "call",
    callrailId: "CAL1",
    personSuffix: "p1",
    callrailCompanyId: "COM1",
    occurredAt: NOW,
    rawSourceName: null,
    rawTrackerId: null,
    rawNote: "Jane Doe, 555-123-4567",
    rawTags: [],
    rawFormData: null,
    customerPhoneCallerid: null,
    nameParsed: "Jane Doe",
    phoneParsed: "555-123-4567",
    statusParsed: "pending",
    statusTagMatched: null,
    isOpportunityParsed: false,
    suggestedStatus: "pending",
    parseFailed: false,
    parseError: null,
    needsReview: firmId === null,
    signedAt: null,
    ...over,
  };
}

function existing(
  id: string,
  firmId: string | null,
  over: Partial<ExistingLeadRow> = {},
): ExistingLeadRow {
  return {
    id,
    firmId,
    callrailId: "CAL1",
    personSuffix: "p1",
    hasOverrides: false,
    hasNotes: false,
    ...over,
  };
}

describe("A — unassigned becomes routed", () => {
  it("REPOINTS the queue row instead of inserting beside it", () => {
    const plan = reconcileLeadRows([planned("firm-a")], [existing("row-1", null)]);
    expect(plan.repoint).toEqual([
      {
        rowId: "row-1",
        fromFirmId: null,
        toFirmId: "firm-a",
        callrailId: "CAL1",
        personSuffix: "p1",
      },
    ]);
    expect(plan.deleteRowIds).toEqual([]);
    expect(plan.flagStaleRowIds).toEqual([]);
    // The planned row still upserts — it now matches the repointed row.
    expect(plan.upsert).toHaveLength(1);
  });

  it("does nothing special when the row is already on the right firm", () => {
    const plan = reconcileLeadRows([planned("firm-a")], [existing("row-1", "firm-a")]);
    expect(plan.repoint).toEqual([]);
    expect(plan.deleteRowIds).toEqual([]);
    expect(plan.upsert).toHaveLength(1);
  });

  it("plans a plain insert when nothing exists yet", () => {
    const plan = reconcileLeadRows([planned("firm-a")], []);
    expect(plan.repoint).toEqual([]);
    expect(plan.upsert).toHaveLength(1);
  });
});

describe("B — the lead matches several firms", () => {
  const three = [planned("firm-a"), planned("firm-b"), planned("firm-c")];

  it("promotes the queue row to the FIRST target and inserts the rest", () => {
    const plan = reconcileLeadRows(three, [existing("row-1", null)]);
    expect(plan.repoint).toHaveLength(1);
    expect(plan.repoint[0]).toMatchObject({ rowId: "row-1", toFirmId: "firm-a" });
    expect(plan.upsert).toHaveLength(3);
    expect(plan.deleteRowIds).toEqual([]);
  });

  it("is deterministic — the same input repoints to the same firm", () => {
    const a = reconcileLeadRows(three, [existing("row-1", null)]);
    const b = reconcileLeadRows(three, [existing("row-1", null)]);
    expect(a.repoint).toEqual(b.repoint);
  });

  it("is a no-op once all three rows exist", () => {
    const plan = reconcileLeadRows(three, [
      existing("r1", "firm-a"),
      existing("r2", "firm-b"),
      existing("r3", "firm-c"),
    ]);
    expect(plan.repoint).toEqual([]);
    expect(plan.deleteRowIds).toEqual([]);
    expect(plan.flagStaleRowIds).toEqual([]);
  });

  it("fills a gap by repointing rather than inserting when one firm drops out", () => {
    // Was {a,b}; now {a,c}. The b row becomes the c row, keeping its history.
    const plan = reconcileLeadRows(
      [planned("firm-a"), planned("firm-c")],
      [existing("r1", "firm-a"), existing("r2", "firm-b")],
    );
    expect(plan.repoint).toEqual([
      expect.objectContaining({ rowId: "r2", fromFirmId: "firm-b", toFirmId: "firm-c" }),
    ]);
    expect(plan.deleteRowIds).toEqual([]);
  });
});

describe("C — the lead changes firm", () => {
  it("MOVES the row, so the old firm stops seeing it and history travels with it", () => {
    const plan = reconcileLeadRows([planned("firm-b")], [existing("row-1", "firm-a")]);
    expect(plan.repoint).toEqual([
      expect.objectContaining({ rowId: "row-1", fromFirmId: "firm-a", toFirmId: "firm-b" }),
    ]);
    expect(plan.deleteRowIds).toEqual([]);
    expect(plan.flagStaleRowIds).toEqual([]);
  });

  // Routing is authoritative. This is the behaviour that replaces the old
  // assigned-firm guard, which kept a row whose routing had gone quiet.
  it("DEMOTES back to the queue when routing no longer matches anything", () => {
    const plan = reconcileLeadRows([planned(null)], [existing("row-1", "firm-a")]);
    expect(plan.repoint).toEqual([
      expect.objectContaining({ rowId: "row-1", fromFirmId: "firm-a", toFirmId: null }),
    ]);
    // Demotion keeps the same row, so notes and overrides survive it.
    expect(plan.deleteRowIds).toEqual([]);
  });
});

describe("leftover surplus — a firm loses the lead with nothing to repoint to", () => {
  it("DELETES a surplus row carrying no human work", () => {
    const plan = reconcileLeadRows(
      [planned("firm-a")],
      [existing("r1", "firm-a"), existing("r2", "firm-b")],
    );
    expect(plan.deleteRowIds).toEqual(["r2"]);
    expect(plan.flagStaleRowIds).toEqual([]);
  });

  it.each([
    ["an override", { hasOverrides: true }],
    ["a note", { hasNotes: true }],
    ["both", { hasOverrides: true, hasNotes: true }],
  ])("KEEPS and flags a surplus row carrying %s", (_label, marks) => {
    const plan = reconcileLeadRows(
      [planned("firm-a")],
      [existing("r1", "firm-a"), existing("r2", "firm-b", marks)],
    );
    expect(plan.deleteRowIds).toEqual([]);
    expect(plan.flagStaleRowIds).toEqual(["r2"]);
  });

  it("splits a mixed set — deletes the clean one, flags the touched one", () => {
    const plan = reconcileLeadRows(
      [planned("firm-a")],
      [
        existing("r1", "firm-a"),
        existing("r2", "firm-b"),
        existing("r3", "firm-c", { hasNotes: true }),
      ],
    );
    expect(plan.deleteRowIds).toEqual(["r2"]);
    expect(plan.flagStaleRowIds).toEqual(["r3"]);
  });

  it("prefers repointing over deleting — a move is never a delete plus an insert", () => {
    const plan = reconcileLeadRows(
      [planned("firm-x"), planned("firm-y")],
      [existing("r1", "firm-a", { hasNotes: true }), existing("r2", "firm-b")],
    );
    expect(plan.repoint).toHaveLength(2);
    expect(plan.deleteRowIds).toEqual([]);
    expect(plan.flagStaleRowIds).toEqual([]);
  });
});

describe("grouping", () => {
  it("treats each person on a multi-person note independently", () => {
    const plan = reconcileLeadRows(
      [planned("firm-a", { personSuffix: "p1" }), planned("firm-b", { personSuffix: "p2" })],
      [
        existing("r1", null, { personSuffix: "p1" }),
        existing("r2", null, { personSuffix: "p2" }),
      ],
    );
    expect(plan.repoint).toHaveLength(2);
    expect(plan.repoint.map((r) => [r.personSuffix, r.toFirmId])).toEqual([
      ["p1", "firm-a"],
      ["p2", "firm-b"],
    ]);
  });

  it("never touches a row for a different callrail id", () => {
    const plan = reconcileLeadRows(
      [planned("firm-a")],
      [existing("other", null, { callrailId: "CAL999" })],
    );
    expect(plan.repoint).toEqual([]);
    expect(plan.deleteRowIds).toEqual([]);
    expect(plan.flagStaleRowIds).toEqual([]);
  });

  // A lead that fell out of the sync window entirely must not be reconciled
  // against an empty target set and deleted.
  it("leaves existing rows alone when the lead is not in this run at all", () => {
    const plan = reconcileLeadRows([], [existing("r1", "firm-a")]);
    expect(plan).toEqual({
      repoint: [],
      upsert: [],
      deleteRowIds: [],
      flagStaleRowIds: [],
    });
  });
});

describe("queueReason", () => {
  it.each([
    ["parse failure wins over everything", { parseFailed: true, firmId: null, possibleDuplicateOf: "x" }, "parse_failure"],
    ["unassigned", { parseFailed: false, firmId: null, possibleDuplicateOf: null }, "unassigned"],
    ["duplicate", { parseFailed: false, firmId: "f", possibleDuplicateOf: "x" }, "possible_duplicate"],
    ["stale routing", { parseFailed: false, firmId: "f", possibleDuplicateOf: null }, "stale_routing"],
  ])("%s", (_label, row, expected) => {
    expect(queueReason(row as never)).toBe(expected);
  });

  it("has a label for every reason", () => {
    for (const reason of ["parse_failure", "unassigned", "possible_duplicate", "stale_routing"] as const) {
      expect(QUEUE_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});
