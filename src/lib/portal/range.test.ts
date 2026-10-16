import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PORTAL_MONTHS_BACK,
  allowedPortalWindow,
  assertPortalRange,
  parsePortalRange,
  presetOf,
  presetRange,
  rangeFromSearchParams,
  type PortalDateRange,
} from "./range";

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}
afterEach(() => vi.useRealTimers());

describe("the allowed window", () => {
  it("is the previous Eastern month through today", () => {
    at("2026-10-15T15:00:00Z");
    expect(PORTAL_MONTHS_BACK).toBe(1);
    expect(allowedPortalWindow()).toEqual({ min: "2026-09-01", max: "2026-10-15" });
  });

  it("uses Eastern time at a month boundary (03:30 UTC Nov 1 is still Oct 31 Eastern)", () => {
    at("2026-11-01T03:30:00Z");
    expect(allowedPortalWindow()).toEqual({ min: "2026-09-01", max: "2026-10-31" });
    at("2026-11-01T04:30:00Z"); // 00:30 Nov 1 EDT
    expect(allowedPortalWindow()).toEqual({ min: "2026-10-01", max: "2026-11-01" });
  });

  it("crosses a year boundary in January", () => {
    at("2027-01-10T15:00:00Z");
    expect(allowedPortalWindow()).toEqual({ min: "2026-12-01", max: "2027-01-10" });
  });

  it("is right either side of the fall-back DST change", () => {
    at("2026-11-01T06:30:00Z"); // 01:30 EST, after the clocks went back
    expect(allowedPortalWindow().max).toBe("2026-11-01");
    expect(presetRange("current").endExclusive.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // midnight EST
  });
});

describe("parsePortalRange", () => {
  const w = { min: "2026-09-01", max: "2026-10-15" };

  it("accepts a range inside the window, with Eastern day bounds", () => {
    const r = parsePortalRange("2026-09-28", "2026-10-03", w);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.range.start.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(r.range.endExclusive.toISOString()).toBe("2026-10-04T04:00:00.000Z");
  });

  it("accepts the window's own edges and a single day", () => {
    expect(parsePortalRange("2026-09-01", "2026-10-15", w).ok).toBe(true);
    expect(parsePortalRange("2026-10-15", "2026-10-15", w).ok).toBe(true);
  });

  it.each([
    ["one day before the window", "2026-08-31", "2026-09-05", "out_of_window"],
    ["an older month", "2026-07-01", "2026-07-31", "out_of_window"],
    ["tomorrow", "2026-10-01", "2026-10-16", "out_of_window"],
    ["a future range", "2026-11-01", "2026-11-05", "out_of_window"],
    ["reversed", "2026-10-05", "2026-10-01", "reversed"],
    ["a non-date", "2026-10-01", "yesterday", "malformed"],
    ["an impossible date", "2026-09-31", "2026-10-01", "malformed"],
    ["a timestamp", "2026-10-01T00:00:00Z", "2026-10-02", "malformed"],
    ["SQL in a value", "2026-10-01'; drop table leads;--", "2026-10-02", "malformed"],
    ["an array", ["2026-10-01"], "2026-10-02", "malformed"],
    ["a missing end", "2026-10-01", undefined, "malformed"],
  ])("refuses %s", (_, from, to, reason) => {
    expect(parsePortalRange(from, to, w)).toEqual({ ok: false, reason });
  });
});

describe("presets", () => {
  it("This month runs to today; Last month is the whole previous month", () => {
    at("2026-10-15T15:00:00Z");
    expect(presetRange("current")).toMatchObject({ from: "2026-10-01", to: "2026-10-15" });
    expect(presetRange("previous")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetOf(presetRange("previous"))).toBe("previous");
    expect(presetOf({ from: "2026-10-02", to: "2026-10-05" })).toBeNull();
  });
});

describe("rangeFromSearchParams (what the page accepts)", () => {
  it("defaults to This month, and keeps month=previous as an alias", () => {
    at("2026-10-15T15:00:00Z");
    expect(rangeFromSearchParams({})).toMatchObject({ invalid: false, range: { from: "2026-10-01", to: "2026-10-15" } });
    expect(rangeFromSearchParams({ month: "previous" })).toMatchObject({ invalid: false, range: { from: "2026-09-01" } });
    expect(rangeFromSearchParams({ month: "2020-01" })).toMatchObject({ invalid: false, range: { from: "2026-10-01" } });
  });

  it("accepts a valid from/to", () => {
    at("2026-10-15T15:00:00Z");
    expect(rangeFromSearchParams({ from: "2026-09-10", to: "2026-10-02" })).toMatchObject({
      invalid: false,
      range: { from: "2026-09-10", to: "2026-10-02" },
    });
  });

  it.each([
    [{ from: "2026-08-01", to: "2026-08-31" }],
    [{ from: "2026-10-01", to: "2026-10-20" }],
    [{ from: "2026-10-01" }],
    [{ to: "2026-10-05" }],
    [{ from: ["2026-10-01", "2026-08-01"], to: "2026-10-05" }],
    [{ from: "2026-10-05", to: "2026-10-01" }],
    [{ from: "2026-08-01", to: "2026-08-31", month: "previous" }],
  ])("refuses %j and falls back to This month, never the asked-for dates", (sp) => {
    at("2026-10-15T15:00:00Z");
    const r = rangeFromSearchParams(sp);
    expect(r.invalid).toBe(true);
    expect(r.range).toMatchObject({ from: "2026-10-01", to: "2026-10-15" });
  });
});

describe("assertPortalRange (the re-check inside listVisibleLeads)", () => {
  it("passes a real range", () => {
    at("2026-10-15T15:00:00Z");
    expect(() => assertPortalRange(presetRange("previous"))).not.toThrow();
  });

  it("throws for a forged range outside the window, or with tampered bounds", () => {
    at("2026-10-15T15:00:00Z");
    const forged = {
      from: "2026-01-01",
      to: "2026-01-31",
      start: new Date("2026-01-01T05:00:00Z"),
      endExclusive: new Date("2026-02-01T05:00:00Z"),
    } as unknown as PortalDateRange;
    expect(() => assertPortalRange(forged)).toThrow(/outside the allowed window/);
    const tampered = { ...presetRange("current"), start: new Date("2020-01-01T00:00:00Z") } as PortalDateRange;
    expect(() => assertPortalRange(tampered)).toThrow();
    expect(() => assertPortalRange(null as unknown as PortalDateRange)).toThrow();
  });
});

// The picker must not load data on every day click. There is no DOM test
// environment here, so this pins it in the source: day clicks only update
// the draft (onSelect={setDraft}), and router.push happens in exactly one
// place, go(), which only Apply and the presets call.
describe("the picker navigates only on Apply or a preset (source check, not a click test)", () => {
  it("day selection only sets the draft; one navigation call site", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src", "app", "(portal)", "_components", "date-range-picker.tsx"), "utf8");
    expect(src).toContain("onSelect={setDraft}");
    expect(src.match(/router\.(push|replace)\(/g)).toHaveLength(1);
    expect(src.match(/\bgo\(/g)?.length).toBe(3); // its definition, the presets, Apply
  });
});
