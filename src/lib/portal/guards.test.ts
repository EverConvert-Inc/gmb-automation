import { describe, expect, it } from "vitest";
import { PortalRowError, assertFirmRows, assertRows } from "./guards";

const FIRM = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const SPEC = { id: "string", name: "string?", occurred_at: "date" } as const;
const good = (over: Record<string, unknown> = {}) => ({
  id: "a",
  firm_id: FIRM,
  name: "Jane",
  occurred_at: new Date(),
  ...over,
});

describe("assertFirmRows", () => {
  it("passes rows of the right shape from the session's firm", () => {
    expect(() => assertFirmRows("t", [good(), good({ name: null })], FIRM, SPEC)).not.toThrow();
  });

  it("throws on a row from ANOTHER firm", () => {
    expect(() => assertFirmRows("t", [good({ firm_id: OTHER })], FIRM, SPEC)).toThrow(PortalRowError);
  });

  // Every row, not just the first: tenancy is per row.
  it("checks every row — a bad third row still throws", () => {
    expect(() =>
      assertFirmRows("t", [good(), good(), good({ firm_id: OTHER })], FIRM, SPEC),
    ).toThrow(/row 2/);
  });

  it("throws on a WRONG-KEYS row — a result shaped for some other query", () => {
    expect(() =>
      assertFirmRows("t", [{ firm_id: FIRM, auth_user_id: "x", member_active: true }], FIRM, SPEC),
    ).toThrow(PortalRowError);
  });

  // The earlier crosstalk: another query's values landing in this query's
  // slots. With named keys that is a wrong type in a known field.
  it("throws on a CROSSED row — the right keys with another query's values", () => {
    expect(() =>
      assertFirmRows("t", [good({ name: 1, occurred_at: "2026-10-01" })], FIRM, SPEC),
    ).toThrow(PortalRowError);
  });

  it("requires firm_id even when the caller's spec forgot it", () => {
    const noFirm: Record<string, unknown> = good();
    delete noFirm.firm_id;
    expect(() => assertFirmRows("t", [noFirm], FIRM, SPEC)).toThrow(/firm_id/);
  });

  it("throws when firm_id is the right firm with the wrong type", () => {
    expect(() => assertFirmRows("t", [good({ firm_id: null })], FIRM, SPEC)).toThrow(PortalRowError);
  });

  it("accepts an empty result", () => {
    expect(() => assertFirmRows("t", [], FIRM, SPEC)).not.toThrow();
  });

  it.each([[null], ["row"], [[1, 2]], [7]])("throws on a non-object row %s", (row) => {
    expect(() => assertFirmRows("t", [row], FIRM, SPEC)).toThrow(PortalRowError);
  });
});

describe("assertRows equals", () => {
  it("throws when a pinned value differs", () => {
    expect(() =>
      assertRows("t", [{ auth_user_id: "someone-else" }], { auth_user_id: "string" }, { auth_user_id: "me" }),
    ).toThrow(/does not match the session/);
  });

  it("rejects an invalid Date", () => {
    expect(() => assertRows("t", [{ at: new Date("nope") }], { at: "date" })).toThrow(PortalRowError);
  });

  it("rejects NaN as a number", () => {
    expect(() => assertRows("t", [{ n: NaN }], { n: "number" })).toThrow(PortalRowError);
  });
});
