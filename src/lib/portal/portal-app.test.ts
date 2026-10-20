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

vi.mock("server-only", () => ({}));
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
import { __resetEventsForTests, __setEventSchedulerForTests, __setEventsSqlForTests } from "./events";
import { makeFakeSql, type FakeCall } from "./fake-sql";
import { NOTE_MAX_LENGTH, PORTAL_LEAD_LIMIT } from "./db";
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
    // A Pending tag: the new rule shows Pending or Signed only (visibility.ts).
    status_tag_matched: "Pending",
    negative_tags: "",
    client_approved_at: null as Date | null,
    client_approved_negative_tags: "",
    name,
    name_is_override: false,
    phone: "+15551234567",
    note_body: null,
    note_created_at: null,
    note_author_kind: null,
    note_firm_id: null,
    client_note_body: null,
    client_note_created_at: null,
    client_note_firm_id: null,
    ...SECRETS,
    ...over,
  };
}

let leadsByFirm: Record<string, ReturnType<typeof leadRow>[]> = {};
/** Overrides the honest list answer, to simulate a query returning the wrong rows. */
let listOverride: ((call: FakeCall) => unknown[]) | null = null;
let calls: FakeCall[] = [];

/** lead_notes, append-only, as the fake database holds it. */
type NoteRow = { id: string; lead_id: string; firm_id: string; author_kind: "client" | "staff"; body: string; created_at: Date };
let notes: NoteRow[] = [];

/** What the two lateral joins return for one lead: newest overall, newest client-authored. */
function withNotes(row: ReturnType<typeof leadRow>, firm: string) {
  const mine = notes
    .filter((n) => n.lead_id === row.id && n.firm_id === firm)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  if (mine.length === 0) return row;
  const newest = mine[0];
  const client = mine.find((n) => n.author_kind === "client") ?? null;
  return {
    ...row,
    note_body: newest.body,
    note_created_at: newest.created_at,
    note_author_kind: newest.author_kind,
    note_firm_id: newest.firm_id,
    client_note_body: client?.body ?? null,
    client_note_created_at: client?.created_at ?? null,
    client_note_firm_id: client?.firm_id ?? null,
  };
}

function respond(call: FakeCall): unknown[] {
  if (call.text.includes("from lead_firm_users")) {
    return memberships.filter((m) => m.auth_user_id === call.params[0]);
  }
  if (call.text.includes("from leads l") && call.text.includes("left join lateral")) {
    if (listOverride) return listOverride(call);
    const firm = call.params.find((p) => p === FIRM_A || p === FIRM_B) as string;
    return (leadsByFirm[firm] ?? []).map((r) => withNotes(r, firm));
  }
  if (call.text.includes("insert into lead_notes")) {
    // Honest stand-in for the INSERT … SELECT: inserts only for a lead of the
    // bound firm.
    const leadId = call.params.find((p) => p === LEAD_A || p === LEAD_B);
    const firm = call.params.find((p) => p === FIRM_A || p === FIRM_B) as string;
    const lead = (leadsByFirm[firm] ?? []).find((l) => l.id === leadId);
    if (!lead) return [];
    // Always a NEW row, author 'client' (the SQL literal), never an update.
    expect(call.text).toContain("'client'");
    expect(call.text).not.toMatch(/\bupdate\b|\bdelete\b/i);
    const row: NoteRow = {
      id: `d1d1d1d1-d1d1-4d1d-8d1d-${String(notes.length + 1).padStart(12, "0")}`,
      lead_id: lead.id,
      firm_id: firm,
      author_kind: "client",
      body: call.params[2] as string,
      created_at: new Date(Date.UTC(2026, 9, 15, 15, 0, notes.length + 1)),
    };
    notes.push(row);
    return [{ id: row.id, lead_id: row.lead_id, firm_id: row.firm_id, created_at: row.created_at }];
  }
  throw new Error(`unexpected query: ${call.text.slice(0, 80)}`);
}

function signedIn(id: string, appMetadata: unknown, email = "user@example.com") {
  h.getUser.mockResolvedValue({ data: { user: { id, email, app_metadata: appMetadata } }, error: null });
}
const asClientA = () => signedIn(USER_A, { role: "client" }, "a@firm-a.com");
const asClientB = () => signedIn(USER_B, { role: "client" }, "b@firm-b.com");

beforeEach(() => {
  __resetEventsForTests();
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
  notes = [];
  // Activity-log writes: captured, run only when a test asks.
  eventTasks = [];
  __setEventSchedulerForTests((task) => void eventTasks.push(task));
  const events = makeFakeSql(() => []);
  eventCalls = events.calls;
  __setEventsSqlForTests(events.sql);
  const fake = makeFakeSql(respond);
  calls = fake.calls;
  __setPortalSqlForTests(fake.sql);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  __setPortalSqlForTests(null);
  __setEventSchedulerForTests(null);
  __setEventsSqlForTests(null);
});

let eventTasks: (() => Promise<void>)[] = [];
let eventCalls: FakeCall[] = [];
async function runEventTasks() {
  for (const t of eventTasks.splice(0)) await t();
}
/** [event_type, metadata] of every event write attempted. */
const eventsWritten = () =>
  eventCalls.map((c) => [c.params[2], JSON.parse(c.params[4] as string)] as [string, Record<string, unknown>]);

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

  it("/portal/login shows the light EverConvert logo by default, not the old scales icon", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const html = render((await LoginPage()) as ReactElement);
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(2);
    const [light, dark] = imgs;
    expect(light).toContain('alt="EverConvert"');
    expect(light).toContain("everconvert-logo-green-black.png");
    expect(light).toContain("portal-logo-light");
    expect(dark).toContain('alt="EverConvert"');
    expect(dark).toContain("ec-logo.png");
    expect(dark).toContain("portal-logo-dark");
    // The swap is the portal's own CSS, never Tailwind's dark: (which follows html.dark).
    for (const img of imgs) expect(img).not.toMatch(/\bdark:/);
    expect(html).not.toContain("lucide-scale");
    expect(html).toContain("Client portal");
    expect(html).toContain("Sign in to see your firm&#x27;s leads.");
  });

  it("/portal/login: the heading and subtitle sit inside the sign-in card, above the form", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const html = render((await LoginPage()) as ReactElement);
    const card = html.slice(html.indexOf('class="rounded-2xl border bg-card'));
    expect(card.indexOf(">Client portal</h1>")).toBeGreaterThan(0);
    expect(card.indexOf("Sign in to see your firm")).toBeLessThan(card.indexOf('type="password"'));
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf('class="rounded-2xl border bg-card'));
  });

  it("/portal/no-access shows the same logo instead of the shield icon", async () => {
    signedIn(STAFF_ID, { role: "admin" });
    const html = render((await NoAccessPage()) as ReactElement);
    expect(html).toContain("everconvert-logo-green-black.png");
    expect(html).toContain("ec-logo.png");
    expect(html).not.toContain("lucide-shield-alert");
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
    expect(html).toContain("Pending");
    // Clients see two labels only: no Opportunity label, card or filter option.
    expect(html).not.toContain("Opportunity");
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
        client_note_body: "Client says hi",
        client_note_created_at: new Date("2026-10-13T15:00:00Z"),
        client_note_firm_id: FIRM_A,
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
      // Opportunity only, approved for the client: shown as Pending.
      leadRow(FIRM_A, "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4", "Approved Person", { status_tag_matched: null, client_approved_at: new Date("2026-10-12T15:00:00Z") }),
    ];
    const html = await leadsMarkup();
    expect(statusCell(html, "Signed Person")).toBe("Signed");
    expect(statusCell(html, "Pending Person")).toBe("Pending");
    expect(statusCell(html, "Approved Person")).toBe("Pending");
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

  it("the summary counts the month's leads by label, from the same list (no extra query)", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [
      leadRow(FIRM_A, LEAD_A, "S1", { effective_status: "signed", status_tag_matched: "Signed" }),
      leadRow(FIRM_A, "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3", "P1", { status_tag_matched: "Pending" }),
      leadRow(FIRM_A, "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4", "P2", { status_tag_matched: "Pending" }),
      leadRow(FIRM_A, "a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5", "A1", { status_tag_matched: null, client_approved_at: new Date() }),
    ];
    const before = calls.length;
    const html = await leadsMarkup();
    const summary = html.slice(html.indexOf("<dl"), html.indexOf("</dl>"));
    const count = (label: string) =>
      summary.slice(summary.indexOf(label)).match(/<dd[^>]*>(\d+)<\/dd>/)?.[1];
    // Two cards: Signed and Pending (the approved Opportunity-only lead counts as Pending).
    expect([count("Signed"), count("Pending")]).toEqual(["1", "3"]);
    expect(summary).not.toContain("Opportunity");
    expect(html).toContain("4 leads");
    // One membership lookup per render (layout and page share it in a real
    // request via cache()) and one list query — nothing else.
    const queries = calls.slice(before).map((c) => (c.text.includes("from leads l") ? "list" : "membership"));
    expect(queries.filter((q) => q === "list")).toHaveLength(1);
  });

  it("on a phone, each lead is a card with the same fields — label only, no date in the badge, no hidden field", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [
      leadRow(FIRM_A, LEAD_A, "Card Person", {
        effective_status: "signed",
        status_tag_matched: "Signed",
        signed_at: new Date("2026-10-11T15:00:00Z"),
      }),
    ];
    const html = await leadsMarkup();
    const cards = html.slice(html.indexOf('<ul class="space-y-3 md:hidden"'));
    expect(cards).toContain("Card Person");
    expect(cards).toContain("(555) 123-4567");
    expect(cards).toContain("Oct 10, 2026");
    const badge = cards.match(/class="portal-status [^"]*">((?:<span[^>]*><\/span>)?[^<]*)<\/span>/)?.[1] ?? "";
    expect(badge.replace(/<[^>]*>/g, "")).toBe("Signed");
    expect(html).not.toContain("Oct 11");
    expect(html).not.toContain("SECRET");
  });

  it("the header: firm name on the left, a user menu with the email, theme toggle and sign-out, closed by default", async () => {
    asClientA();
    const html = await leadsMarkup();
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain("Alpha Law");
    expect(header).toMatch(/aria-label="Open user menu"[^>]*aria-expanded="false"/);
    expect(header).toContain(">A</button>"); // the avatar's initial
    const panel = header.slice(header.indexOf("hidden=\"\""));
    expect(header).toMatch(/<div[^>]*hidden=""/);
    expect(panel).toContain("Signed in as");
    expect(panel).toContain("a@firm-a.com");
    expect(panel).toContain("Switch to dark theme");
    expect(panel).toContain("Sign out");
    // The email is only inside the menu, never under the firm name.
    expect(header.indexOf("a@firm-a.com")).toBeGreaterThan(header.indexOf("Open user menu"));
    expect(header.split("a@firm-a.com")).toHaveLength(3); // the title attribute and the text, both in the panel
  });

  it("the phone number is plain text (no tel: link), and each lead has a one-line note field", async () => {
    asClientA();
    const html = await leadsMarkup();
    expect(html).toContain("(555) 123-4567");
    expect(html).not.toContain("tel:");
    expect(html).not.toMatch(/<a[^>]*>\(555\)/);
    const fields = html.match(/<textarea[^>]*>/g) ?? [];
    expect(fields).toHaveLength(2); // the table row and the phone card for the one lead
    for (const f of fields) {
      expect(f).toContain('rows="1"');
      expect(f).toContain('placeholder="Add a note"');
      expect(f).toContain('maxLength="2000"');
    }
    expect(html).not.toContain(">Add note<");
    expect(html).not.toContain("No notes yet");
  });

  it("the status filter's counts match the month summary and use no extra query", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [
      leadRow(FIRM_A, LEAD_A, "S1", { effective_status: "signed", status_tag_matched: "Signed" }),
      leadRow(FIRM_A, "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3", "P1", { status_tag_matched: "Pending" }),
      leadRow(FIRM_A, "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4", "A1", { status_tag_matched: null, client_approved_at: new Date() }),
    ];
    const before = calls.length;
    const html = await leadsMarkup();
    const facet = (s: string) => html.match(new RegExp(`data-facet-count="${s}"[^>]*>(\\d+)<`))?.[1];
    expect([facet("signed"), facet("pending"), facet("opportunity")]).toEqual(["1", "2", undefined]);
    expect(calls.slice(before).filter((c) => c.text.includes("from leads l"))).toHaveLength(1);
    expect(html).not.toContain("SECRET");
  });

  // -------------------------------------------------------------------------
  // The editable note
  // -------------------------------------------------------------------------
  /** The text inside the first note field (the desktop table row) for a lead. */
  function fieldText(html: string, name: string): string {
    const row = html.slice(html.lastIndexOf("<tr", html.indexOf(name))).split("</tr>")[0];
    return row.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "";
  }

  it("saving adds a NEW note row and the field then holds it; saving again appends, never updates", async () => {
    asClientA();
    expect(fieldText(await leadsMarkup(), "Alice Alpha")).toBe("");

    expect((await note({ body: "First note" })).status).toBe(201);
    let html = await leadsMarkup();
    expect(fieldText(html, "Alice Alpha")).toBe("First note");
    expect(html).toContain("Updated Oct 15");

    expect((await note({ body: "Second note" })).status).toBe(201);
    html = await leadsMarkup();
    expect(fieldText(html, "Alice Alpha")).toBe("Second note");
    expect(notes.map((n) => [n.author_kind, n.body])).toEqual([
      ["client", "First note"],
      ["client", "Second note"],
    ]);
    expect(inserts()).toHaveLength(2);
  });

  it("no byline and no 'Note saved' line", async () => {
    asClientA();
    await note({ body: "Our note" });
    const html = await leadsMarkup();
    expect(html).not.toContain("Your firm");
    expect(html).not.toContain("Note saved");
    expect(html).not.toMatch(/EverConvert ·/);
  });

  it("a newer staff note shows read-only above the field, which still holds the firm's own note", async () => {
    asClientA();
    await note({ body: "Our note" });
    notes.push({
      id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
      lead_id: LEAD_A,
      firm_id: FIRM_A,
      author_kind: "staff",
      body: "Staff follow-up",
      created_at: new Date("2026-10-15T18:00:00Z"),
    });
    const html = await leadsMarkup();
    const row = html.slice(html.lastIndexOf("<tr", html.indexOf("Alice Alpha"))).split("</tr>")[0];
    expect(row).toContain("From EverConvert");
    expect(row.indexOf("Staff follow-up")).toBeLessThan(row.indexOf("<textarea"));
    expect(fieldText(html, "Alice Alpha")).toBe("Our note");
  });

  it("a staff note that is not the newest is not shown", async () => {
    asClientA();
    notes.push({
      id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2",
      lead_id: LEAD_A,
      firm_id: FIRM_A,
      author_kind: "staff",
      body: "Old staff note",
      created_at: new Date("2026-10-01T15:00:00Z"),
    });
    await note({ body: "Our newer note" });
    const html = await leadsMarkup();
    expect(html).not.toContain("Old staff note");
    expect(html).not.toContain("From EverConvert");
  });

  it("one firm never sees or edits another firm's note", async () => {
    asClientA();
    await note({ body: "Alpha's private note" });
    // A cannot write to B's lead.
    expect((await note({ body: "Alpha writing on Bravo" }, { leadId: LEAD_B })).status).toBe(404);
    expect(notes.every((n) => n.firm_id === FIRM_A)).toBe(true);
    // B sees nothing of A's.
    asClientB();
    const html = await leadsMarkup();
    expect(html).not.toContain("Alpha's private note");
    expect(html).not.toContain("Alpha writing on Bravo");
    expect(fieldText(html, "Bob Bravo")).toBe("");
  });

  // -------------------------------------------------------------------------
  // The date range: enforced by the page, whatever the URL says
  // -------------------------------------------------------------------------
  const listBounds = () =>
    calls
      .filter((c) => c.text.includes("from leads l"))
      .map((c) => c.params.filter((p) => p instanceof Date).map((d) => (d as Date).toISOString()));

  it("a valid custom range is queried with exactly its Eastern bounds", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [leadRow(FIRM_A, LEAD_A, "Alice Alpha", { occurred_at: new Date("2026-10-02T15:00:00Z") })];
    const html = await leadsMarkup({ from: "2026-09-28", to: "2026-10-03" });
    expect(listBounds()).toEqual([["2026-09-28T04:00:00.000Z", "2026-10-04T04:00:00.000Z"]]);
    expect(html).toContain("Sep 28 – Oct 3, 2026");
    expect(html).not.toContain("isn&#x27;t available");
  });

  it.each([
    ["an older month", { from: "2026-08-01", to: "2026-08-31" }],
    ["a future day", { from: "2026-10-01", to: "2026-10-16" }],
    ["reversed", { from: "2026-10-05", to: "2026-10-01" }],
    ["malformed", { from: "2026-10-01", to: "soon" }],
    ["only one end", { from: "2026-08-01" }],
  ])("%s is refused: a notice, and the query uses This month, never the asked-for dates", async (_, sp) => {
    asClientA();
    const html = await leadsMarkup(sp as Record<string, string>);
    expect(html).toContain("That date range isn&#x27;t available");
    expect(listBounds()).toEqual([["2026-10-01T04:00:00.000Z", "2026-10-16T04:00:00.000Z"]]);
  });

  it("the picker: the applied range on the trigger, both presets, Apply disabled until the draft changes, future days disabled", async () => {
    asClientA();
    const html = await leadsMarkup();
    expect(html).toMatch(/data-range-label="[^"]*">October 2026</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>This month</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Last month</);
    expect(html).toMatch(/role="dialog" aria-label="Choose dates"[^>]*hidden=""/);
    expect(html).toMatch(/disabled=""[^>]*>Apply</);
    // The calendar is limited to the window: Oct 16 onwards cannot be picked.
    expect(html).toMatch(/aria-label="[^"]*October 16[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="[^"]*October 16/);
  });

  // -------------------------------------------------------------------------
  // Activity log hooks
  // -------------------------------------------------------------------------
  const signedInAt = "2026-10-15T14:03:22.123456Z";
  const asClientAFresh = () =>
    h.getUser.mockResolvedValue({
      data: { user: { id: USER_A, email: "a@firm-a.com", app_metadata: { role: "client" }, last_sign_in_at: signedInAt } },
      error: null,
    });

  it("the leads page logs a sign-in and a page view for the session's firm and user, after the response", async () => {
    asClientAFresh();
    await leadsMarkup();
    expect(eventCalls).toHaveLength(0); // nothing written during the render
    expect(eventTasks).toHaveLength(1);
    await runEventTasks();
    expect(eventsWritten()).toEqual([
      ["sign_in", { signed_in_at: signedInAt }],
      ["page_view", { page: "leads", range: "current" }],
    ]);
    for (const c of eventCalls) {
      expect(c.params.slice(0, 2)).toEqual([FIRM_A, USER_A]);
      expect(c.params).not.toContain(FIRM_B);
    }
  });

  it("no sign-in event when Auth gives no sign-in time", async () => {
    asClientA();
    await leadsMarkup();
    await runEventTasks();
    expect(eventsWritten().map(([t]) => t)).toEqual(["page_view"]);
  });

  it.each([
    [{ month: "previous" }, "previous"],
    [{ from: "2026-09-28", to: "2026-10-03" }, "custom"],
  ])("a page view records the range kind only: %j → %s", async (sp, range) => {
    asClientA();
    leadsByFirm[FIRM_A] = [];
    await leadsMarkup(sp);
    await runEventTasks();
    expect(eventsWritten()).toEqual([["page_view", { page: "leads", range }]]);
    expect(JSON.stringify(eventCalls)).not.toMatch(/2026-09-28|2026-10-03/);
  });

  it("a refused URL range logs \"refused\" without the dates", async () => {
    asClientA();
    await leadsMarkup({ from: "2026-08-01", to: "2026-08-31" });
    await runEventTasks();
    expect(eventsWritten()).toEqual([["page_view", { page: "leads", range: "refused" }]]);
    expect(JSON.stringify(eventCalls)).not.toMatch(/2026-08/);
  });

  it("a refused session logs nothing", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await redirectOf(() => LeadsPage(searchParams()));
    expect(eventTasks).toHaveLength(0);
  });

  // Logging can never slow or break the page: the write is fire-and-forget.
  it.each([
    ["hangs forever", () => makeFakeSql(() => new Promise(() => {})).sql, "run"],
    ["throws", () => makeFakeSql(() => { throw new Error("db down"); }).sql, "run"],
    ["after() itself throws", () => makeFakeSql(() => []).sql, "throw"],
  ] as const)("the leads page renders normally when the event writer %s", async (_, sql, scheduler) => {
    asClientAFresh();
    __setEventsSqlForTests(sql());
    __setEventSchedulerForTests(
      scheduler === "throw"
        ? () => {
            throw new Error("`after` was called outside a request scope");
          }
        : (task) => void task(), // started at once and NOT awaited, like after()
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const started = Date.now();
    const html = await leadsMarkup();
    expect(html).toContain("Alice Alpha");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("shows an empty state when there are no leads", async () => {
    asClientA();
    leadsByFirm[FIRM_A] = [];
    const html = await leadsMarkup();
    expect(html).toContain("No leads for October 2026");
    // No leads table (the date picker's calendar is a table of its own).
    expect(html).not.toContain("<caption");
    expect(html).not.toContain("Latest note");
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

  it("a saved note logs note_saved with the inserted row's lead id, after the response", async () => {
    asClientA();
    const res = await note({ body: "Private note text" });
    expect(res.status).toBe(201);
    expect(eventCalls).toHaveLength(0);
    await runEventTasks();
    expect(eventsWritten()).toEqual([["note_saved", {}]]);
    expect(eventCalls[0].params).toEqual(expect.arrayContaining([FIRM_A, USER_A, LEAD_A]));
    expect(JSON.stringify(eventCalls)).not.toContain("Private note text");
  });

  it.each([
    ["a lead of another firm", { body: "x" }, { leadId: LEAD_B }],
    ["an empty note", { body: "   " }, {}],
    ["extra keys", { body: "x", firmId: FIRM_B }, {}],
  ])("no note_saved for %s", async (_, body, opts) => {
    asClientA();
    const res = await note(body, opts);
    expect(res.status).not.toBe(201);
    expect(eventTasks).toHaveLength(0);
  });

  it.each([
    ["hangs forever", () => makeFakeSql(() => new Promise(() => {})).sql],
    ["throws", () => makeFakeSql(() => { throw new Error("db down"); }).sql],
  ] as const)("the notes route still answers 201 at once when the event writer %s", async (_, sql) => {
    asClientA();
    __setEventsSqlForTests(sql());
    __setEventSchedulerForTests((task) => void task());
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await note({ body: "Still saved" });
    expect(res.status).toBe(201);
    expect(notes.map((n) => n.body)).toEqual(["Still saved"]);
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

// ---------------------------------------------------------------------------
// The lead limit: a range past PORTAL_LEAD_LIMIT says so instead of
// undercounting silently.
// ---------------------------------------------------------------------------
describe("the leads page at the lead limit", () => {
  const manyLeads = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      leadRow(FIRM_A, `a3a3a3a3-a3a3-4a3a-8a3a-${String(i).padStart(12, "0")}`, `Lead ${i}`),
    );
  /** Honours the query's own LIMIT, as Postgres would. */
  function limitedList(call: FakeCall) {
    const limit = call.params[call.params.length - 1] as number;
    return (leadsByFirm[FIRM_A] ?? []).slice(0, limit);
  }
  const NOTICE = `Showing the first ${PORTAL_LEAD_LIMIT} leads; narrow the date range.`;
  /** The three summary numbers, as rendered. */
  const cardNumbers = (html: string) =>
    [...html.matchAll(/<dd class="mt-1 font-display[^"]*">([^<]*(?:<!-- -->)?[^<]*)<\/dd>/g)].map((m) =>
      m[1].replace(/<!-- -->/g, ""),
    );

  beforeEach(() => {
    asClientA();
    listOverride = limitedList;
  });

  it("asks for one row past the limit", async () => {
    leadsByFirm[FIRM_A] = manyLeads(3);
    await leadsMarkup();
    const list = calls.find((c) => c.text.includes("from leads l"))!;
    expect(list.text).toMatch(/limit \$\d+\s*$/);
    expect(list.params[list.params.length - 1]).toBe(PORTAL_LEAD_LIMIT + 1);
  });

  it("past the limit: a notice, 500+ in the header, and every card reads as at-least", async () => {
    leadsByFirm[FIRM_A] = manyLeads(PORTAL_LEAD_LIMIT + 40);
    const html = await leadsMarkup();
    expect(html).toContain(NOTICE);
    expect(html).toMatch(/role="status"[^>]*>.*?Showing the first 500 leads/);
    expect(html.replace(/<!-- -->/g, "")).toContain(`· ${PORTAL_LEAD_LIMIT}+ leads`);
    const numbers = cardNumbers(html);
    expect(numbers).toHaveLength(2);
    for (const n of numbers) expect(n).toMatch(/^\d+\+$/);
    expect(numbers.reduce((sum, n) => sum + parseInt(n, 10), 0)).toBe(PORTAL_LEAD_LIMIT);
    expect(html.match(/In the first 500 leads/g)).toHaveLength(2);
    // The extra row is fetched to detect the cut-off, never shown.
    expect(html).not.toContain(`Lead ${PORTAL_LEAD_LIMIT}<`);
  });

  it("exactly at the limit: no notice, plain counts", async () => {
    leadsByFirm[FIRM_A] = manyLeads(PORTAL_LEAD_LIMIT);
    const html = await leadsMarkup();
    expect(html).not.toContain("Showing the first");
    expect(html).not.toContain("In the first 500");
    for (const n of cardNumbers(html)) expect(n).toMatch(/^\d+$/);
  });

  it("an ordinary range: no notice", async () => {
    leadsByFirm[FIRM_A] = manyLeads(3);
    expect(await leadsMarkup()).not.toContain("Showing the first");
  });
});


// ---------------------------------------------------------------------------
// Leads without a usable name: hidden from the list, the cards and the count
// ---------------------------------------------------------------------------
describe("the leads page and unusable names", () => {
  beforeEach(() => asClientA());

  it("the list, the header count and the summary cards all leave them out, and agree", async () => {
    leadsByFirm[FIRM_A] = [
      leadRow(FIRM_A, LEAD_A, "Alice Alpha"),
      leadRow(FIRM_A, "a4a4a4a4-a4a4-4a4a-8a4a-000000000001", "No Name", { effective_status: "signed", signed_at: new Date("2026-10-11T15:00:00Z") }),
      leadRow(FIRM_A, "a4a4a4a4-a4a4-4a4a-8a4a-000000000002", "5551234567"),
      leadRow(FIRM_A, "a4a4a4a4-a4a4-4a4a-8a4a-000000000003", "Google Local Services Ads"),
      leadRow(FIRM_A, "a4a4a4a4-a4a4-4a4a-8a4a-000000000004", "Fixed By Staff", { name_is_override: true }),
    ];
    const html = (await leadsMarkup()).replace(/<!-- -->/g, "");
    // The leads table (the date picker's calendar has a tbody too).
    const leadsTable = html.slice(html.indexOf("<caption"));
    const table = leadsTable.slice(leadsTable.indexOf("<tbody"), leadsTable.indexOf("</tbody>"));
    const rows = table.match(/<tr\b/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(table).toContain("Alice Alpha");
    expect(table).toContain("Fixed By Staff");
    for (const hidden of ["No Name", "5551234567", "Google Local Services Ads"]) expect(html).not.toContain(hidden);
    expect(html).toContain("· 2 leads");
    const cards = [...html.matchAll(/<dd class="mt-1 font-display[^"]*">\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(cards).toEqual([0, 2]); // signed, pending — the signed No Name lead is not counted
    expect(html).not.toContain("Unknown caller");
  });
});
