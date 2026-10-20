import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setPortalSqlForTests } from "./client";
import { NOTE_MAX_LENGTH, addClientNote, listVisibleLeads } from "./db";
import { parsePortalRange, presetRange } from "./range";
import { makeFakeSql, type FakeCall } from "./fake-sql";
import { PortalRowError } from "./guards";
import type { SessionFirmId } from "./types";
import { HIDDEN_TAGS, clientVisibleSql } from "./visibility";
import { STAFF_NAMED_SQL, unusableNameSql } from "./usable-name";

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
    name_is_override: false,
    negative_tags: "",
    client_approved_at: null as Date | null,
    client_approved_negative_tags: "",
    phone: "555-123-4567",
    note_body: null,
    note_created_at: null,
    note_author_kind: null,
    note_firm_id: null,
    client_note_body: null,
    client_note_created_at: null,
    client_note_firm_id: null,
    ...over,
  };
}

describe("listVisibleLeads — the query", () => {
  it("binds the session firm in the visibility rule and BOTH note joins", async () => {
    answer([]);
    await listVisibleLeads(FIRM, presetRange("current"));
    const firmParams = calls[0].params.filter((p) => p === FIRM);
    expect(firmParams).toHaveLength(3);
    // The firm's own note: client-authored only.
    expect(calls[0].text).toMatch(/and n\.author_kind = 'client'\s+order by n\.created_at desc, n\.id desc\s+limit 1/);
    expect(calls[0].text).toContain("l.firm_id = $");
    expect(calls[0].text).toContain("n.firm_id = $");
  });

  it("binds no firm other than the session's", async () => {
    answer([]);
    await listVisibleLeads(FIRM, presetRange("current"));
    const uuids = calls[0].params.filter(
      (p) => typeof p === "string" && /^[0-9a-f-]{36}$/.test(p),
    );
    expect(new Set(uuids)).toEqual(new Set([FIRM]));
  });

  it("applies the client-visibility rule in SQL: the shared fragment, not a copy", async () => {
    answer([]);
    await listVisibleLeads(FIRM, presetRange("current"));
    const flat = (t: string) => t.replace(/\s+/g, " ");
    const t = flat(calls[0].text);
    expect(t).toContain("l.needs_review = false");
    expect(t).toContain(flat(clientVisibleSql("l")));
    // Opportunity alone no longer shows anything.
    expect(t).not.toContain("is_opportunity");
  });

  // The negative tags are SQL literals; this keeps them identical to the six status tags.
  it("treats exactly the six outcome tags as negative in SQL", async () => {
    answer([]);
    await listVisibleLeads(FIRM, presetRange("current"));
    const list = /x\.k in \(([^)]*)\)/.exec(calls[0].text)?.[1] ?? "";
    expect(list.split(",").map((s) => s.trim().replace(/^'|'$/g, ""))).toEqual(HIDDEN_TAGS.map((t) => t.toLowerCase()));
  });

  it("binds half-open Eastern bounds: This month runs to the end of TODAY, never beyond", async () => {
    answer([]);
    await listVisibleLeads(FIRM, presetRange("current"));
    const dates = calls[0].params.filter((p) => p instanceof Date) as Date[];
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2026-10-01T04:00:00.000Z", // Oct 1, 00:00 EDT
      "2026-10-16T04:00:00.000Z", // the start of Oct 16 EDT: all of today, Oct 15, included
    ]);
    expect(calls[0].text).toContain("then coalesce(l.signed_at, l.occurred_at)");
  });

  it("refuses a forged out-of-window range before any query runs", async () => {
    answer([]);
    const forged = {
      from: "2026-01-01",
      to: "2026-01-31",
      start: new Date("2026-01-01T05:00:00Z"),
      endExclusive: new Date("2026-02-01T05:00:00Z"),
    } as unknown as Parameters<typeof listVisibleLeads>[1];
    await expect(listVisibleLeads(FIRM, forged)).rejects.toThrow(/outside the allowed window/);
    expect(calls).toHaveLength(0);
  });

  it("keeps the anchor rule for a custom range: called Sep 28, signed Oct 3 belongs to Oct 1–5, not Sep", async () => {
    const row = leadRow({
      effective_status: "signed",
      effective_opportunity: false,
      status_tag_matched: "Signed",
      occurred_at: new Date("2026-09-28T15:00:00Z"),
      signed_at: new Date("2026-10-03T15:00:00Z"),
    });
    const inOct = parsePortalRange("2026-10-01", "2026-10-05");
    const inSep = parsePortalRange("2026-09-01", "2026-09-30");
    if (!inOct.ok || !inSep.ok) throw new Error("bad test ranges");
    answer([row]);
    await expect(listVisibleLeads(FIRM, inOct.range)).resolves.toHaveLength(1);
    // Postgres would not return it for September; if it ever did, the re-check refuses it.
    answer([row]);
    await expect(listVisibleLeads(FIRM, inSep.range)).rejects.toThrow(/outside 2026-09-01\.\.2026-09-30/);
  });

  it("never selects the CallRail note, tags, source or channel", async () => {
    answer([]);
    await listVisibleLeads(FIRM, presetRange("current"));
    for (const col of ["raw_note", "raw_source_name", "raw_tracker_id", "raw_form_data", "callrail_company_id"]) {
      expect(calls[0].text).not.toContain(col);
    }
    // raw_tags is read ONLY inside the negative-tag test (unnest), never selected:
    // the row gets just the negative tag keys, never the tags.
    const text = calls[0].text.replace(/\s+/g, " ");
    expect(text.match(/raw_tags/g)?.length).toBe(text.match(/unnest\(l\.raw_tags\)/g)?.length);
  });
});

describe("listVisibleLeads — what it returns", () => {
  it("returns only the client-facing fields", async () => {
    answer([leadRow()]);
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(Object.keys(lead).sort()).toEqual(
      ["date", "firmNote", "id", "name", "phone", "signedDate", "staffNote", "status"].sort(),
    );
    // The fixture's matched tag is Pending, so the label is Pending.
    expect(lead).toMatchObject({ status: "pending", date: "2026-10-10", signedDate: null, firmNote: null, staffNote: null });
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
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(lead.status).toBe("signed");
    expect(lead.date).toBe("2026-09-28"); // the call date
    expect(lead.signedDate).toBe("2026-10-02"); // Eastern, not the UTC Oct 3
  });

  it("a newest note by staff is shown read-only, and the firm's own note is still carried", async () => {
    answer([
      leadRow({
        note_body: "Called back",
        note_created_at: new Date("2026-10-11T02:00:00Z"),
        note_author_kind: "staff",
        note_firm_id: FIRM,
        client_note_body: "Our note",
        client_note_created_at: new Date("2026-10-09T15:00:00Z"),
        client_note_firm_id: FIRM,
      }),
    ]);
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(lead.staffNote).toEqual({ body: "Called back", date: "2026-10-10" });
    expect(lead.firmNote).toEqual({ body: "Our note", date: "2026-10-09" });
  });

  it("when the newest note is the firm's own, there is no staff note", async () => {
    answer([
      leadRow({
        note_body: "Our note",
        note_created_at: new Date("2026-10-12T15:00:00Z"),
        note_author_kind: "client",
        note_firm_id: FIRM,
        client_note_body: "Our note",
        client_note_created_at: new Date("2026-10-12T15:00:00Z"),
        client_note_firm_id: FIRM,
      }),
    ]);
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(lead.staffNote).toBeNull();
    expect(lead.firmNote).toEqual({ body: "Our note", date: "2026-10-12" });
  });


  it("23:30 Eastern on the last day of the month stays in that month", async () => {
    vi.setSystemTime(new Date("2026-10-31T20:00:00Z"));
    answer([leadRow({ occurred_at: new Date("2026-11-01T03:30:00Z") })]); // Oct 31, 23:30 EDT
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(lead.date).toBe("2026-10-31");
  });

  it("an approval covering its negative tags shows it, as Pending or Signed", async () => {
    answer([
      leadRow({ status_tag_matched: "Lost", negative_tags: "lost", client_approved_at: new Date(), client_approved_negative_tags: "lost" }),
    ]);
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(lead.status).toBe("pending");
  });

  it("an approved Opportunity-only lead shows as Pending — the client has only two labels", async () => {
    answer([leadRow({ status_tag_matched: null, client_approved_at: new Date() })]);
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(lead.status).toBe("pending");
  });
});

describe("listVisibleLeads — throws instead of rendering", () => {
  it.each([
    ["a row from another firm", { firm_id: OTHER }],
    ["a note from another firm", { note_body: "x", note_created_at: new Date(), note_author_kind: "client", note_firm_id: OTHER }],
    ["a firm note from another firm", { client_note_body: "x", client_note_created_at: new Date(), client_note_firm_id: OTHER }],
    ["a wrong-keys row", { effective_status: undefined, auth_user_id: USER }],
    ["a crossed row", { name: 1, occurred_at: "2026-10-10" }],
    ["a needs_review lead", { needs_review: true }],
    ["an Opportunity-only lead (no Pending tag)", { status_tag_matched: null }],
    ["a lead the SQL says carries a negative tag", { negative_tags: "no case" }],
    ["approved, but for fewer negative tags than it carries now", { negative_tags: "lost,no case", client_approved_at: new Date(), client_approved_negative_tags: "no case" }],
    ["negative_tags that is not text (an array)", { negative_tags: ["no case"] }],
    ["a staff status override no longer un-hides a negative tag", { negative_tags: "lost", has_status_override: true }],
    ["a hidden-tag lead with no override", { status_tag_matched: "Lost" }],
    ["a lead from outside the month", { occurred_at: new Date("2026-11-01T04:30:00Z") }],
  ])("%s", async (_label, over) => {
    answer([leadRow(), leadRow(over)]);
    await expect(listVisibleLeads(FIRM, presetRange("current"))).rejects.toBeInstanceOf(PortalRowError);
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

describe("listVisibleLeads — leads without a usable name are not shown", () => {
  it("the shared visibility SQL hides them, unless staff typed a name", async () => {
    answer([]);
    await listVisibleLeads(FIRM, presetRange("current"));
    const flat = (t: string) => t.replace(/\s+/g, " ");
    const text = flat(calls[0].text);
    expect(text).toContain(flat(`${STAFF_NAMED_SQL} or not ${unusableNameSql("coalesce(l.name_override, l.name_parsed)")}`));
    expect(text).toMatch(/\(l\.name_override is not null and btrim\(l\.name_override\) <> ''\)\s+as name_is_override/);
    expect(text).not.toContain("raw_source_name");
  });

  it("the note insert uses the same rule (one fragment)", async () => {
    answer([]);
    await addClientNote(FIRM, USER, "c@firm.com", LEAD, "hello").catch(() => {});
    const insert = calls.find((c) => c.text.includes("insert into lead_notes"));
    const flat = (t: string) => t.replace(/\s+/g, " ");
    expect(flat(insert?.text ?? "")).toContain(flat(unusableNameSql("coalesce(l.name_override, l.name_parsed)")));
  });

  it.each([["No Name"], [" no name. "], [""], [null], ["5551234567"], ["(555) 123-4567"], ["Google Local Services Ads"]])(
    "a row with name %j that got past the SQL is dropped, not shown",
    async (name) => {
      answer([leadRow({ name }), leadRow({ id: "55555555-5555-5555-5555-555555555555", name: "Jane Doe" })]);
      const leads = await listVisibleLeads(FIRM, presetRange("current"));
      expect(leads.map((l) => l.name)).toEqual(["Jane Doe"]);
    },
  );

  it("a staff override keeps it, even a number", async () => {
    answer([leadRow({ name: "5551234567", name_is_override: true })]);
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(lead.name).toBe("5551234567");
  });

  it("a real name passes through untouched", async () => {
    answer([leadRow()]);
    const [lead] = await listVisibleLeads(FIRM, presetRange("current"));
    expect(lead.name).toBe("Jane Doe");
  });
});
