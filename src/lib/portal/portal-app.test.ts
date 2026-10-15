// The portal's pages and notes route, end to end through the REAL session
// check, visibility guards and SQL builders. Faked: the Supabase session
// lookup, the portal's SQL connection, and Next's redirect().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly to: string) {
      super(`redirect ${to}`);
    }
  }
  return { RedirectSignal, getUser: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser: h.getUser } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new h.RedirectSignal(to);
  },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

import { __setPortalSqlForTests } from "./client";
import { makeFakeSql, type FakeCall } from "./fake-sql";
import { NOTE_MAX_LENGTH } from "./db";
import FirmLayout from "@/app/(portal)/portal/(firm)/layout";
import LeadsPage from "@/app/(portal)/portal/(firm)/page";
import LoginPage from "@/app/(portal)/portal/login/page";
import NoAccessPage from "@/app/(portal)/portal/no-access/page";
import { POST as postNote } from "@/app/api/portal/leads/[leadId]/notes/route";

// ---------------------------------------------------------------------------
// Two firms, each with one client user, in one fake database.
// ---------------------------------------------------------------------------
const FIRM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const USER_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const STAFF_ID = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const LEAD_A = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const LEAD_B = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";

type Membership = { firm_id: string; auth_user_id: string; member_active: boolean; firm_active: boolean; firm_name: string };
let memberships: Membership[] = [];

// Fields the portal must never show. Present on every fake row, so a render
// that printed any column it was handed would be caught.
const SECRETS = {
  source: "SECRET-SOURCE-google-ads",
  channel: "SECRET-CHANNEL-PMax",
  tags: ["SECRET-TAG-SmithLaw"],
  matched_tag: "SECRET-MATCHED-TAG",
  callrail_note: "SECRET-CALLRAIL-NOTE",
  raw_note: "SECRET-RAW-NOTE",
  status_parsed: "SECRET-STATUS-PARSED",
  needs_review_reason: "SECRET-ADMIN-FIELD",
};

function leadRow(firm: string, id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    firm_id: firm,
    occurred_at: new Date("2026-10-10T15:00:00Z"),
    signed_at: null,
    effective_status: "pending",
    effective_opportunity: true,
    needs_review: false,
    has_status_override: false,
    status_tag_matched: "SECRET-STATUS-TAG-MATCHED",
    name,
    phone: "+15551234567",
    note_body: null,
    note_created_at: null,
    note_author_kind: null,
    note_firm_id: null,
    ...SECRETS,
    ...over,
  };
}

let leadsByFirm: Record<string, ReturnType<typeof leadRow>[]> = {};
/** Overrides the honest list answer, to simulate a query returning the wrong rows. */
let listOverride: ((call: FakeCall) => unknown[]) | null = null;
let calls: FakeCall[] = [];

function respond(call: FakeCall): unknown[] {
  if (call.text.includes("from lead_firm_users")) {
    return memberships.filter((m) => m.auth_user_id === call.params[0]);
  }
  if (call.text.includes("from leads l") && call.text.includes("left join lateral")) {
    if (listOverride) return listOverride(call);
    const firm = call.params.find((p) => p === FIRM_A || p === FIRM_B) as string;
    return leadsByFirm[firm] ?? [];
  }
  if (call.text.includes("insert into lead_notes")) {
    // Honest stand-in for the INSERT … SELECT: inserts only for a lead of the
    // bound firm.
    const leadId = call.params.find((p) => p === LEAD_A || p === LEAD_B);
    const firm = call.params.find((p) => p === FIRM_A || p === FIRM_B) as string;
    const lead = (leadsByFirm[firm] ?? []).find((l) => l.id === leadId);
    return lead
      ? [{ id: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1", lead_id: lead.id, firm_id: firm, created_at: new Date("2026-10-15T15:00:00Z") }]
      : [];
  }
  throw new Error(`unexpected query: ${call.text.slice(0, 80)}`);
}

function signedIn(id: string, appMetadata: unknown, email = "user@example.com") {
  h.getUser.mockResolvedValue({ data: { user: { id, email, app_metadata: appMetadata } }, error: null });
}
const asClientA = () => signedIn(USER_A, { role: "client" }, "a@firm-a.com");
const asClientB = () => signedIn(USER_B, { role: "client" }, "b@firm-b.com");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
  h.getUser.mockReset();
  memberships = [
    { firm_id: FIRM_A, auth_user_id: USER_A, member_active: true, firm_active: true, firm_name: "Alpha Law" },
    { firm_id: FIRM_B, auth_user_id: USER_B, member_active: true, firm_active: true, firm_name: "Bravo Legal" },
  ];
  leadsByFirm = {
    [FIRM_A]: [leadRow(FIRM_A, LEAD_A, "Alice Alpha")],
    [FIRM_B]: [leadRow(FIRM_B, LEAD_B, "Bob Bravo")],
  };
  listOverride = null;
  const fake = makeFakeSql(respond);
  calls = fake.calls;
  __setPortalSqlForTests(fake.sql);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  __setPortalSqlForTests(null);
});

const render = (el: ReactElement) => renderToStaticMarkup(el);

/** The visible text of the status column (4th cell) in the row for `name`. */
function statusCell(html: string, name: string): string {
  const row = html.slice(html.lastIndexOf("<tr", html.indexOf(name))).split("</tr>")[0];
  const cell = row.split(/<td\b/)[4] ?? "";
  return cell.replace(/<[^>]*>/g, "").replace(/^[^>]*>/, "").trim();
}
const searchParams = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) });

async function leadsMarkup(sp: Record<string, string> = {}) {
  const page = await LeadsPage(searchParams(sp));
  const layout = await FirmLayout({ children: page });
  return render(layout);
}

/** Runs fn and returns where it redirected, or null if it did not. */
async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof h.RedirectSignal) return e.to;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------
const REFUSED: [string, () => void, string][] = [
  ["signed out", () => h.getUser.mockResolvedValue({ data: { user: null }, error: null }), "/portal/login"],
  ["staff", () => signedIn(STAFF_ID, { role: "admin" }), "/portal/no-access"],
  ["untagged", () => signedIn(STAFF_ID, { provider: "email" }), "/portal/no-access"],
  ["client role in user_metadata only", () => h.getUser.mockResolvedValue({ data: { user: { id: USER_A, app_metadata: {}, user_metadata: { role: "client" } } }, error: null }), "/portal/no-access"],
  ["client without a membership", () => signedIn(STAFF_ID, { role: "client" }), "/portal/no-access"],
  ["inactive membership", () => { asClientA(); memberships[0].member_active = false; }, "/portal/no-access"],
  ["inactive firm", () => { asClientA(); memberships[0].firm_active = false; }, "/portal/no-access"],
];

describe("pages refuse everyone but an active client", () => {
  it.each(REFUSED)("%s: the leads page and the firm layout redirect, and no lead is read", async (_, setup, to) => {
    setup();
    expect(await redirectOf(() => LeadsPage(searchParams()))).toBe(to);
    expect(await redirectOf(() => FirmLayout({ children: null }))).toBe(to);
    expect(calls.some((c) => c.text.includes("from leads l"))).toBe(false);
  });

  it.each(REFUSED.filter(([, , to]) => to === "/portal/no-access"))(
    "%s: /portal/no-access renders, with no links",
    async (_, setup) => {
      setup();
      const html = render((await NoAccessPage()) as ReactElement);
      expect(html).toContain("No access");
      expect(html).not.toMatch(/<a\b/);
    },
  );

  it("signed out: /portal/no-access sends to the login", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await redirectOf(() => NoAccessPage())).toBe("/portal/login");
  });

  it("an active client on /portal/no-access or /portal/login goes to /portal", async () => {
    asClientA();
    expect(await redirectOf(() => NoAccessPage())).toBe("/portal");
    expect(await redirectOf(() => LoginPage())).toBe("/portal");
  });

  it.each(REFUSED)("%s: /portal/login shows the form", async (_, setup) => {
    setup();
    const html = render((await LoginPage()) as ReactElement);
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/sign up|forgot/i);
  });

  it("a hung Auth call fails at 10s with an error (not a redirect to the login)", async () => {
    vi.useRealTimers(); // replace the Date-only fakes with full ones
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    h.getUser.mockReturnValue(new Promise(() => {}));
    const pending = LeadsPage(searchParams()).then(
      () => "rendered",
      (e: unknown) => (e instanceof h.RedirectSignal ? `redirect ${e.to}` : "threw"),
    );
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("threw");
  });
});

// ---------------------------------------------------------------------------
// What the leads page shows
// ---------------------------------------------------------------------------
describe("the leads page", () => {
  it("shows the firm name, the email, a sign-out button, and the lead's columns", async () => {
    asClientA();
    const html = await leadsMarkup();
    expect(html).toContain("Alpha Law");
    expect(html).toContain("a@firm-a.com");
    expect(html).toContain("Sign out");
    expect(html).toContain("Alice Alpha");
    expect(html).toContain("(555) 123-4567");
    expect(html).toContain("Oct 10, 2026");
    expect(html).toContain("Opportunity");
    expect(html).toContain("October 2026");
    // No internal navigation.
    expect(html).not.toMatch(/href="\/(clients|ppc|lsa|admin|settings|login)/);
  });

  it("never renders source, channel, tags, matched tag, the CallRail note or admin fields", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [
      leadRow(FIRM_A, LEAD_A, "Alice Alpha", {
        effective_status: "signed",
        signed_at: new Date("2026-10-12T15:00:00Z"),
        note_body: "Client says hi",
        note_created_at: new Date("2026-10-13T15:00:00Z"),
        note_author_kind: "client",
        note_firm_id: FIRM_A,
      }),
    ];
    const html = await leadsMarkup();
    expect(statusCell(html, "Alice Alpha")).toBe("Signed");
    expect(html).toContain("Client says hi");
    expect(html).not.toContain("SECRET");
  });

  it("the header carries the theme toggle next to sign-out, and still no hidden field", async () => {
    asClientA();
    const html = await leadsMarkup();
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain("Switch to dark theme");
    expect(header).toContain("Sign out");
    expect(header.indexOf("Switch to dark theme")).toBeLessThan(header.indexOf("Sign out"));
    expect(html).not.toContain("SECRET");
  });

  it("the month switch reads only current/previous and the query uses that month", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [leadRow(FIRM_A, LEAD_A, "Alice Alpha", { occurred_at: new Date("2026-09-20T15:00:00Z") })];
    const html = await leadsMarkup({ month: "previous" });
    expect(html).toContain("September 2026");
    expect(html).toContain("Alice Alpha");

    // Anything else falls back to the current month.
    leadsByFirm[FIRM_A] = [];
    expect(await leadsMarkup({ month: "2020-01" })).toContain("October 2026");
  });

  it("renders each status label", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [
      leadRow(FIRM_A, LEAD_A, "Signed Person", { effective_status: "signed", status_tag_matched: "Signed", signed_at: new Date("2026-10-11T15:00:00Z") }),
      leadRow(FIRM_A, "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3", "Pending Person", { status_tag_matched: "Pending" }),
      leadRow(FIRM_A, "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4", "Opportunity Person", { status_tag_matched: null }),
    ];
    const html = await leadsMarkup();
    expect(statusCell(html, "Signed Person")).toBe("Signed");
    expect(statusCell(html, "Pending Person")).toBe("Pending");
    expect(statusCell(html, "Opportunity Person")).toBe("Opportunity");
  });

  it("the status cell holds the label only — no date, even for a signed lead with a signed date", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [
      leadRow(FIRM_A, LEAD_A, "Signed Person", {
        effective_status: "signed",
        status_tag_matched: "Signed",
        occurred_at: new Date("2026-09-28T15:00:00Z"),
        signed_at: new Date("2026-10-11T15:00:00Z"),
      }),
    ];
    const html = await leadsMarkup();
    const cell = statusCell(html, "Signed Person");
    expect(cell).toBe("Signed");
    expect(cell).not.toMatch(/\d/);
    expect(cell).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    // signed_at still places it: called in September, listed under October.
    expect(html).toContain("October 2026");
    expect(html).toContain("Sep 28, 2026"); // the call date, in the date column
    expect(html).not.toContain("Oct 11");
  });

  it("shows an empty state when there are no leads", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [];
    const html = await leadsMarkup();
    expect(html).toContain("No leads for October 2026");
    expect(html).not.toContain("<table");
  });

  it("two firms' data never mixes: each client sees only their own firm", async () => {
    asClientA();
    const a = await leadsMarkup();
    asClientB();
    const b = await leadsMarkup();
    expect(a).toContain("Alice Alpha");
    expect(a).toContain("Alpha Law");
    expect(a).not.toContain("Bob Bravo");
    expect(a).not.toContain("Bravo Legal");
    expect(b).toContain("Bob Bravo");
    expect(b).not.toContain("Alice Alpha");
    expect(b).not.toContain("Alpha Law");
  });

  it("a query that returns another firm's row stops the render — nothing partial is shown", async () => {
    asClientA();
    listOverride = () => [leadRow(FIRM_A, LEAD_A, "Alice Alpha"), leadRow(FIRM_B, LEAD_B, "Bob Bravo")];
    await expect(LeadsPage(searchParams())).rejects.toThrow(/firm/i);
  });

  it("a note from another firm on the lead stops the render", async () => {
    asClientA();
    listOverride = () => [
      leadRow(FIRM_A, LEAD_A, "Alice Alpha", {
        note_body: "Bravo's private note",
        note_created_at: new Date(),
        note_author_kind: "client",
        note_firm_id: FIRM_B,
      }),
    ];
    await expect(LeadsPage(searchParams())).rejects.toThrow(/note_firm_id/);
  });
});

// ---------------------------------------------------------------------------
// The notes route
// ---------------------------------------------------------------------------
function note(body: unknown, { leadId = LEAD_A, raw = false, contentType = "application/json" } = {}) {
  const req = new Request(`http://x/api/portal/leads/${leadId}/notes`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  return postNote(req, { params: Promise.resolve({ leadId }) });
}
const inserts = () => calls.filter((c) => c.text.includes("insert into lead_notes"));

describe("POST /api/portal/leads/[leadId]/notes", () => {
  it.each(REFUSED.map(([who, setup, to]) => [who, setup, to === "/portal/login" ? 401 : 403] as const))(
    "%s → %i, nothing written",
    async (_, setup, status) => {
      setup();
      const res = await note({ body: "hello" });
      expect(res.status).toBe(status);
      expect(inserts()).toEqual([]);
    },
  );

  it("a hung Auth call → 503 at 10s, nothing written", async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    h.getUser.mockReturnValue(new Promise(() => {}));
    const pending = note({ body: "hello" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(503);
    expect(inserts()).toEqual([]);
  });

  it("saves a note: firm and author from the session, 201, the note back for display", async () => {
    asClientA();
    const res = await note({ body: "  Called them back  " });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(await res.json()).toEqual({
      note: { id: expect.any(String), body: "Called them back", author: "client", date: "2026-10-15" },
    });
    const [ins] = inserts();
    expect(ins.params).toEqual(expect.arrayContaining([FIRM_A, USER_A, "a@firm-a.com", LEAD_A, "Called them back"]));
    expect(ins.params).not.toContain(FIRM_B);
  });

  it.each([
    ["a firm id", { body: "x", firmId: FIRM_B }],
    ["firm_id", { body: "x", firm_id: FIRM_B }],
    ["a user id", { body: "x", userId: USER_B }],
    ["an author", { body: "x", author: "staff" }],
    ["a lead id", { body: "x", leadId: LEAD_B }],
    ["no body", {}],
    ["a non-string body", { body: 42 }],
    ["an object body", { body: { text: "x" } }],
    ["an array", [{ body: "x" }]],
    ["null", null],
  ])("rejects %s with 400, nothing written", async (_, payload) => {
    asClientA();
    const res = await note(payload);
    expect(res.status).toBe(400);
    expect(inserts()).toEqual([]);
  });

  it.each([
    ["malformed JSON", '{"body": "x"', "application/json"],
    ["a form post", "body=x", "application/x-www-form-urlencoded"],
    ["plain text", "x", "text/plain"],
  ])("rejects %s with 400", async (_, raw, contentType) => {
    asClientA();
    const res = await note(raw, { raw: true, contentType });
    expect(res.status).toBe(400);
    expect(inserts()).toEqual([]);
  });

  it("caps the length: 2000 characters saves, 2001 is refused, blank is refused", async () => {
    asClientA();
    expect((await note({ body: "x".repeat(NOTE_MAX_LENGTH) })).status).toBe(201);
    expect((await note({ body: "x".repeat(NOTE_MAX_LENGTH + 1) })).status).toBe(400);
    expect((await note({ body: "   " })).status).toBe(400);
    expect((await note({ body: "x".repeat(1_000_000) })).status).toBe(400);
    expect(inserts()).toHaveLength(1);
  });

  it("another firm's lead → 404 (the same answer as a lead that doesn't exist)", async () => {
    asClientA();
    const other = await note({ body: "hello" }, { leadId: LEAD_B });
    expect(other.status).toBe(404);
    const missing = await note({ body: "hello" }, { leadId: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1" });
    expect(missing.status).toBe(404);
    expect(await other.json()).toEqual(await missing.json());
    // The insert was attempted, bound to firm A only.
    for (const c of inserts()) expect(c.params).not.toContain(FIRM_B);
  });

  it("a lead that is not visible → 404 (the visibility rule is part of the insert)", async () => {
    asClientA();
    await note({ body: "hello" }, { leadId: LEAD_B });
    const [ins] = inserts();
    expect(ins.text).toContain("l.needs_review = false");
    expect(ins.text).toContain("l.firm_id = $");
  });

  it("a malformed lead id → 404 without touching the database", async () => {
    asClientA();
    const res = await note({ body: "hello" }, { leadId: "../../admin" });
    expect(res.status).toBe(404);
    expect(inserts()).toEqual([]);
  });

  it("a database failure → 500 with a generic message, the note text not logged", async () => {
    asClientA();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
    __setPortalSqlForTests(
      makeFakeSql((c) => {
        if (c.text.includes("insert into lead_notes")) throw new Error("connection reset with Sensitive note text");
        return respond(c);
      }).sql,
    );
    const res = await note({ body: "Sensitive note text" });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("Sensitive");
    expect(body).not.toContain("connection");
    expect(errors.join("\n")).not.toContain("Sensitive");
  });
});
