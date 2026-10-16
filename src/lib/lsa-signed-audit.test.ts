import { describe, expect, it } from "vitest";
import { attributeSignedCalls, earliestRealMessage, phoneKey } from "./lsa-signed-audit";

// 16:00Z on these dates is mid-day Eastern, so the Eastern date matches.
const at = (d: string) => new Date(`${d}T16:00:00Z`);

describe("attributeSignedCalls", () => {
  it("counts a real call with no event row on its own date", () => {
    const out = attributeSignedCalls([{ callId: "A", date: "2026-10-05", channel: null }], [], "2026-10-01", "2026-10-16");
    expect(out).toEqual([
      expect.objectContaining({ callId: "A", countedOn: "2026-10-05", path: "own-date", countsTowardSigned: true }),
    ]);
  });

  it("leaves a same-day-tagged call (is_rollup_real null) on its own date", () => {
    const out = attributeSignedCalls(
      [{ callId: "A", date: "2026-10-05", channel: null }],
      [{ callId: "A", signedAt: at("2026-10-05"), isRollupReal: null, channel: null }],
      "2026-10-01",
      "2026-10-16",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ countedOn: "2026-10-05", path: "own-date", storedIsRollupReal: null });
  });

  it("moves a call tagged on a later day to that day, once", () => {
    const out = attributeSignedCalls(
      [{ callId: "A", date: "2026-10-03", channel: null }],
      [{ callId: "A", signedAt: at("2026-10-05"), isRollupReal: null, channel: null }],
      "2026-10-01",
      "2026-10-16",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ originDate: "2026-10-03", countedOn: "2026-10-05", path: "moved-in" });
  });

  it("still counts a stored moved-in row whose call is no longer real", () => {
    const out = attributeSignedCalls(
      [],
      [{ callId: "A", signedAt: at("2026-10-05"), isRollupReal: true, channel: "LSA" }],
      "2026-10-01",
      "2026-10-16",
    );
    expect(out).toEqual([
      expect.objectContaining({ countedOn: "2026-10-05", path: "moved-in", isCurrentCandidate: false }),
    ]);
  });

  it("ignores stored rows targeting a date outside the range", () => {
    const out = attributeSignedCalls(
      [],
      [{ callId: "A", signedAt: at("2026-09-20"), isRollupReal: true, channel: null }],
      "2026-10-01",
      "2026-10-16",
    );
    expect(out).toEqual([]);
  });

  it("reproduces the double count when a stored real row targets its own date", () => {
    const out = attributeSignedCalls(
      [{ callId: "A", date: "2026-10-05", channel: null }],
      [{ callId: "A", signedAt: at("2026-10-05"), isRollupReal: true, channel: null }],
      "2026-10-01",
      "2026-10-16",
    );
    expect(out.map((r) => r.path)).toEqual(["own-date", "moved-in"]);
  });

  it("does not count GMB toward signed", () => {
    const out = attributeSignedCalls([{ callId: "A", date: "2026-10-05", channel: "GMB" }], [], "2026-10-01", "2026-10-16");
    expect(out[0].countsTowardSigned).toBe(false);
  });
});

describe("earliestRealMessage", () => {
  const cats = [
    { label: "Signed", callrailTagName: "Signed", rollup: "real" as const },
    { label: "Junk", callrailTagName: "Spam", rollup: "junk" as const },
  ];

  it("picks the earliest real message and ignores non-category tags", () => {
    const r = earliestRealMessage(
      [
        { created_at: "2026-10-06T09:00:00-04:00", tags: ["Signed"] },
        { created_at: "2026-10-05T08:44:00-04:00", tags: ["Signed", "2 Person"] },
      ],
      cats,
    );
    expect(r).toMatchObject({ date: "2026-10-05", labels: ["Signed"] });
  });

  it("lets junk win within a single message only", () => {
    const r = earliestRealMessage(
      [
        { created_at: "2026-10-05T08:00:00-04:00", tags: ["Signed", "Spam"] },
        { created_at: "2026-10-07T08:00:00-04:00", tags: ["Signed"] },
      ],
      cats,
    );
    expect(r?.date).toBe("2026-10-07");
  });
});

describe("phoneKey", () => {
  it("normalises formats to the last 10 digits", () => {
    expect(phoneKey("+1 (980) 497-1221")).toBe("9804971221");
    expect(phoneKey("980-497-1221")).toBe("9804971221");
  });
});
