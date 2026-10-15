import { describe, expect, it } from "vitest";
import { firmIdsIn, flagPossibleDuplicates, type FirmPhoneRow } from "./dedup";
import type { PlannedLead } from "./types";

const NOW = new Date("2026-10-14T15:00:00Z");

function planned(over: Partial<PlannedLead> = {}): PlannedLead {
  return {
    firmId: "firm-a",
    source: "call",
    callrailId: "CAL-NEW",
    personSuffix: "p1",
    callrailCompanyId: "COM1",
    occurredAt: NOW,
    rawSourceName: null,
    rawTrackerId: null,
    rawNote: null,
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
    needsReview: false,
    possibleDuplicateOf: null,
    signedAt: null,
    ...over,
  };
}

const onFile = (over: Partial<FirmPhoneRow> = {}): FirmPhoneRow => ({
  leadId: "existing-1",
  firmId: "firm-a",
  callrailId: "CAL-OLD",
  phone: "555-123-4567",
  ...over,
});

describe("flagPossibleDuplicates", () => {
  it("flags a lead whose phone is already on file at the same firm", () => {
    const r = flagPossibleDuplicates([planned()], [onFile()]);
    expect(r.flagged).toBe(1);
    expect(r.rows[0].possibleDuplicateOf).toBe("existing-1");
    // FLIPPED (C8): was needsReview true. needs_review now means "hidden from
    // clients", and a caller who phoned twice is still a real lead the firm
    // should see — the flag lives in possible_duplicate_of alone.
    expect(r.rows[0].needsReview).toBe(false);
  });

  it.each([
    ["(555) 123-4567", "555-123-4567"],
    ["+1 555.123.4567", "5551234567"],
    ["1-555-123-4567", "(555) 123 4567"],
    ["555-123-4567 ext 12", "5551234567"],
  ])("matches %s against %s however they were written", (a, b) => {
    const r = flagPossibleDuplicates([planned({ phoneParsed: a })], [onFile({ phone: b })]);
    expect(r.flagged).toBe(1);
  });

  it("does not flag a different number", () => {
    const r = flagPossibleDuplicates(
      [planned({ phoneParsed: "555-999-8888" })],
      [onFile()],
    );
    expect(r.flagged).toBe(0);
    expect(r.rows[0].possibleDuplicateOf).toBeNull();
  });

  // The carve-out the spec calls for: one note naming two people who share a
  // phone is one household, not two leads filed twice.
  it("EXEMPTS people split from the same multi-person note", () => {
    const r = flagPossibleDuplicates(
      [planned({ callrailId: "CAL-OLD", personSuffix: "p2" })],
      [onFile({ callrailId: "CAL-OLD" })],
    );
    expect(r.flagged).toBe(0);
    expect(r.rows[0].possibleDuplicateOf).toBeNull();
  });

  it("does not flag a lead against its own stored row", () => {
    const r = flagPossibleDuplicates(
      [planned({ callrailId: "CAL-OLD" })],
      [onFile({ callrailId: "CAL-OLD" })],
    );
    expect(r.flagged).toBe(0);
  });

  it("is scoped to the firm — the same phone at another firm is not a duplicate", () => {
    const r = flagPossibleDuplicates([planned()], [onFile({ firmId: "firm-b" })]);
    expect(r.flagged).toBe(0);
  });

  it("never flags an unassigned lead — there is no firm to be duplicated within", () => {
    const r = flagPossibleDuplicates(
      [planned({ firmId: null })],
      [onFile({ firmId: "firm-a" })],
    );
    expect(r.flagged).toBe(0);
    expect(r.rows[0].needsReview).toBe(false);
  });

  it.each([[null], [""], ["No Number"], ["12345"]])(
    "ignores an unusable phone (%s) rather than matching everything to it",
    (phone) => {
      const r = flagPossibleDuplicates(
        [planned({ phoneParsed: phone })],
        [onFile({ phone })],
      );
      expect(r.flagged).toBe(0);
    },
  );

  it("points at the FIRST stored lead when several share the phone", () => {
    const r = flagPossibleDuplicates(
      [planned()],
      [onFile({ leadId: "first" }), onFile({ leadId: "second", callrailId: "CAL-X" })],
    );
    expect(r.rows[0].possibleDuplicateOf).toBe("first");
  });

  it("leaves every other field on the row untouched", () => {
    const input = planned();
    const r = flagPossibleDuplicates([input], [onFile()]);
    // FLIPPED (C8): needsReview is no longer part of the change — only
    // possibleDuplicateOf moves.
    expect(r.rows[0]).toEqual({
      ...input,
      possibleDuplicateOf: "existing-1",
    });
  });

  it("returns the rows unchanged when nothing is on file", () => {
    const input = [planned(), planned({ callrailId: "CAL-2" })];
    const r = flagPossibleDuplicates(input, []);
    expect(r.flagged).toBe(0);
    expect(r.rows).toEqual(input);
  });

  it("keeps a flag that is already set when it still applies", () => {
    const r = flagPossibleDuplicates([planned({ parseFailed: true, needsReview: true })], [onFile()]);
    expect(r.rows[0].needsReview).toBe(true);
    expect(r.rows[0].possibleDuplicateOf).toBe("existing-1");
  });
});

describe("firmIdsIn", () => {
  it("collects the distinct firms a run touches, skipping unassigned", () => {
    expect(
      firmIdsIn([
        planned({ firmId: "a" }),
        planned({ firmId: "b" }),
        planned({ firmId: "a" }),
        planned({ firmId: null }),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("is empty when nothing routed", () => {
    expect(firmIdsIn([planned({ firmId: null })])).toEqual([]);
  });
});
