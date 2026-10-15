import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setPortalSqlForTests } from "./client";
import { NOTE_MAX_LENGTH, addClientNote, listVisibleLeads } from "./db";
import { makeFakeSql, type FakeCall } from "./fake-sql";
import { PortalRowError } from "./guards";
import type { SessionFirmId } from "./types";
import { HIDDEN_TAGS } from "./visibility";

const FIRM = "11111111-1111-1111-1111-111111111111" as SessionFirmId;
const OTHER = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";
const LEAD = "44444444-4444-4444-4444-444444444444";

let calls: FakeCall[] = [];
function answer(rows: unknown[] | ((call: FakeCall) => unknown[])) {
  const fake = makeFakeSql((call) => (typeof rows === "function" ? rows(call) : rows));
  calls = fake.calls;
  __setPortalSqlForTests(fake.sql);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00Z")); // October, EDT
});
afterEach(() => {
  vi.useRealTimers();
  __setPortalSqlForTests(null);
});

function leadRow(over: Record<string, unknown> = {}) {
  return {
    id: LEAD,
    firm_id: FIRM,
    occurred_at: new Date("2026-10-10T15:00:00Z"),
    signed_at: null,
    effective_status: "pending",
    effective_opportunity: true,
    needs_review: false,
    has_status_override: false,
    status_tag_matched: "Pending",
    name: "Jane Doe",
    phone: "555-123-4567",
    note_body: null,
    note_created_at: null,
    note_author_kind: null,
    note_firm_id: null,
    ...over,
  };
}

describe("listVisibleLeads — the query", () => {
  it("binds the session firm in BOTH the visibility rule and the note join", async () => {
    answer([]);
    await listVisibleLeads(FIRM, "current");
    const firmParams = calls[0].params.filter((p) => p === FIRM);
    expect(firmParams).toHaveLength(2);
    expect(calls[0].text).toContain("l.firm_id = $");
    expect(calls[0].text).toContain("n.firm_id = $");
  });

  it("binds no firm other than the session's", async () => {
    answer([]);
    await listVisibleLeads(FIRM, "current");
    const uuids = calls[0].params.filter(
      (p) => typeof p === "string" && /^[0-9a-f-]{36}$/.test(p),
    );
    expect(new Set(uuids)).toEqual(new Set([FIRM]));
  });

  it("applies the visibility rule in SQL", async () => {
    answer([]);
    await listVisibleLeads(FIRM, "current");
    const t = calls[0].text;
    expect(t).toContain("l.needs_review = false");
    expect(t).toContain("coalesce(l.status_override, l.status_parsed) = 'signed'");
    expect(t).toContain("coalesce(l.is_opportunity_override, l.is_opportunity_parsed) = true");
    expect(t).toContain("l.status_override is not null");
  });

  // The hidden tags are SQL literals; this keeps them identical to HIDDEN_TAGS.
  it("hides exactly HIDDEN_TAGS in SQL", async () => {
    answer([]);
    await listVisibleLeads(FIRM, "current");
    const list = /status_tag_matched not in \(([^)]*)\)/.exec(calls[0].text)?.[1] ?? "";
    expect(list.split(",").map((s) => s.trim().replace(/^'|'$/g, ""))).toEqual([...HIDDEN_TAGS]);
  });

  it("binds the Eastern month's half-open bounds", async () => {
    answer([]);
    await listVisibleLeads(FIRM, "current");
    const dates = calls[0].params.filter((p) => p instanceof Date) as Date[];
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2026-10-01T04:00:00.000Z",
      "2026-11-01T04:00:00.000Z",
    ]);
    expect(calls[0].text).toContain("then coalesce(l.signed_at, l.occurred_at)");
  });

  it("never selects the CallRail note, tags, source or channel", async () => {
    answer([]);
    await listVisibleLeads(FIRM, "current");
    for (const col of ["raw_note", "raw_tags", "raw_source_name", "raw_tracker_id", "raw_form_data", "callrail_company_id"]) {
      expect(calls[0].text).not.toContain(col);
    }
  });
});

describe("listVisibleLeads — what it returns", () => {
  it("returns only the client-facing fields", async () => {
    answer([leadRow()]);
    const [lead] = await listVisibleLeads(FIRM, "current");
    expect(Object.keys(lead).sort()).toEqual(
      ["date", "id", "latestNote", "name", "phone", "signedDate", "status"].sort(),
    );
    // The fixture's matched tag is Pending, so the label is Pending.
    expect(lead).toMatchObject({ status: "pending", date: "2026-10-10", signedDate: null, latestNote: null });
  });

  it("a signed lead shows its Eastern signed date", async () => {
    answer([
      leadRow({
        effective_status: "signed",
        effective_opportunity: false,
        status_tag_matched: "Signed",
        occurred_at: new Date("2026-09-28T15:00:00Z"), // called in September
        signed_at: new Date("2026-10-03T01:30:00Z"), // signed Oct 2, 21:30 EDT
      }),
    ]);
    const [lead] = await listVisibleLeads(FIRM, "current");
    expect(lead.status).toBe("signed");
    expect(lead.date).toBe("2026-09-28"); // the call date
    expect(lead.signedDate).toBe("2026-10-02"); // Eastern, not the UTC Oct 3
  });

  it("carries the newest portal/staff note, from the session's firm", async () => {
    answer([
      leadRow({
        note_body: "Called back",
        note_created_at: new Date("2026-10-11T02:00:00Z"),
        note_author_kind: "staff",
        note_firm_id: FIRM,
      }),
    ]);
    const [lead] = await listVisibleLeads(FIRM, "current");
    expect(lead.latestNote).toEqual({ body: "Called back", author: "staff", date: "2026-10-10" });
  });

  it("23:30 Eastern on the last day of the month stays in that month", async () => {
    vi.setSystemTime(new Date("2026-10-31T20:00:00Z"));
    answer([leadRow({ occurred_at: new Date("2026-11-01T03:30:00Z") })]); // Oct 31, 23:30 EDT
    const [lead] = await listVisibleLeads(FIRM, "current");
    expect(lead.date).toBe("2026-10-31");
  });

  it("an override beats the hidden-tag rule", async () => {
    answer([leadRow({ status_tag_matched: "Lost", has_status_override: true })]);
    await expect(listVisibleLeads(FIRM, "current")).resolves.toHaveLength(1);
  });
});

describe("listVisibleLeads — throws instead of rendering", () => {
  it.each([
    ["a row from another firm", { firm_id: OTHER }],
    ["a note from another firm", { note_body: "x", note_created_at: new Date(), note_author_kind: "client", note_firm_id: OTHER }],
    ["a wrong-keys row", { effective_status: undefined, auth_user_id: USER }],
    ["a crossed row", { name: 1, occurred_at: "2026-10-10" }],
    ["a needs_review lead", { needs_review: true }],
    ["a pending lead that is not an opportunity", { effective_opportunity: false }],
    ["a hidden-tag lead with no override", { status_tag_matched: "Lost" }],
    ["a lead from outside the month", { occurred_at: new Date("2026-11-01T04:30:00Z") }],
  ])("%s", async (_label, over) => {
    answer([leadRow(), leadRow(over)]);
    await expect(listVisibleLeads(FIRM, "current")).rejects.toBeInstanceOf(PortalRowError);
  });
});

describe("addClientNote", () => {
  const inserted = (over: Record<string, unknown> = {}) => ({
    id: "55555555-5555-5555-5555-555555555555",
    lead_id: LEAD,
    firm_id: FIRM,
    created_at: new Date(),
    ...over,
  });

  it("inserts in ONE statement scoped to the lead, the session firm and visibility", async () => {
    answer([inserted()]);
    const r = await addClientNote(FIRM, USER, "c@firm.com", LEAD, "  Spoke to them  ");
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const t = calls[0].text;
    expect(t).toMatch(/^insert into lead_notes .* select .* from leads l where l\.id = \$\d+::uuid and l\.firm_id = \$\d+::uuid and l\.needs_review = false/);
    expect(t).toContain("'client'"); // author_kind is a literal, not an input
    expect(calls[0].params).toEqual(expect.arrayContaining([FIRM, LEAD, USER, "c@firm.com", "Spoke to them"]));
  });

  it("not-found when nothing matched — the same answer whether or not the id exists elsewhere", async () => {
    answer([]);
    await expect(addClientNote(FIRM, USER, null, LEAD, "hi")).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it.each([["   "], [""], ["x".repeat(NOTE_MAX_LENGTH + 1)]])(
    "rejects the body %j without touching the database",
    async (body) => {
      answer([]);
      await expect(addClientNote(FIRM, USER, null, LEAD, body)).resolves.toEqual({ ok: false, reason: "invalid_body" });
      expect(calls).toHaveLength(0);
    },
  );

  it("accepts a body at exactly the limit", async () => {
    answer([inserted()]);
    const r = await addClientNote(FIRM, USER, null, LEAD, "x".repeat(NOTE_MAX_LENGTH));
    expect(r.ok).toBe(true);
  });

  it.each([["not-a-uuid"], ["1; drop table leads"], [""]])(
    "a malformed lead id %j is not-found and never reaches the database",
    async (leadId) => {
      answer([]);
      await expect(addClientNote(FIRM, USER, null, leadId, "hi")).resolves.toEqual({ ok: false, reason: "not_found" });
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    ["a row from another firm", { firm_id: OTHER }],
    ["a row for a different lead", { lead_id: "66666666-6666-6666-6666-666666666666" }],
    ["a wrong-keys row", { created_at: undefined, body: "x" }],
  ])("throws on %s", async (_label, over) => {
    answer([inserted(over)]);
    await expect(addClientNote(FIRM, USER, null, LEAD, "hi")).rejects.toBeInstanceOf(Error);
  });

  it("throws if more than one row was inserted", async () => {
    answer([inserted(), inserted()]);
    await expect(addClientNote(FIRM, USER, null, LEAD, "hi")).rejects.toThrow(/more than one/);
  });
});

describe("a forged firm id cannot be passed in", () => {
  it("db functions take a SessionFirmId, not a plain string (compile-time)", () => {
    const forged = OTHER;
    // @ts-expect-error a plain string from a URL or body is not a SessionFirmId
    void (() => listVisibleLeads(forged, "current"));
    // @ts-expect-error same for notes
    void (() => addClientNote(forged, USER, null, LEAD, "hi"));
    expect(true).toBe(true);
  });

  it("only the month can be chosen — no free-form date reaches the query", () => {
    // @ts-expect-error a month key from a URL is not accepted
    void (() => listVisibleLeads(FIRM, "2026-09"));
    expect(true).toBe(true);
  });
});
