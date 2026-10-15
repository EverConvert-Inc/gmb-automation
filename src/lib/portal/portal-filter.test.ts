// The portal's status filter and search: pure logic, plus the rendered
// markup of the filter over the rows the page already loaded.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import {
  filterLeads,
  isFiltered,
  matchesSearch,
  statusFacets,
  type FilterableLead,
} from "@/app/(portal)/_lib/filter";
import { LeadsView } from "@/app/(portal)/_components/leads-view";
import type { PortalLead } from "./db";
import type { PortalStatusLabel } from "./visibility";

const lead = (name: string | null, phone: string | null, status: PortalStatusLabel): FilterableLead => ({
  name,
  phone,
  status,
});

const LEADS = [
  lead("Alice Adams", "+15551234567", "signed"),
  lead("Bob Brown", "(555) 987-6543", "pending"),
  lead("Carol Clark", "555.222.3333", "opportunity"),
  lead("Dan Adams", null, "pending"),
  lead(null, "5554440000", "opportunity"),
];
const names = (rows: FilterableLead[]) => rows.map((r) => r.name);
const none = new Set<PortalStatusLabel>();

describe("search (name or phone)", () => {
  it.each([
    ["alice", ["Alice Adams"]],
    ["ADAMS", ["Alice Adams", "Dan Adams"]],
    ["  bob   brown ", ["Bob Brown"]],
    ["555-987", ["Bob Brown"]],
    ["(555) 222", ["Carol Clark"]],
    ["5551234567", ["Alice Adams"]],
    ["4440000", [null]],
    ["zzz", []],
  ])("%j → %j", (query, expected) => {
    expect(names(filterLeads(LEADS, { statuses: none, query }))).toEqual(expected);
  });

  it("an empty query matches everything", () => {
    expect(filterLeads(LEADS, { statuses: none, query: "   " })).toHaveLength(LEADS.length);
  });

  it("a word with a stray digit is not a phone search", () => {
    expect(matchesSearch(lead("Jo", "5552000000", "pending"), "Jo 2")).toBe(false);
  });

  it("a single digit does not match every phone", () => {
    expect(filterLeads(LEADS, { statuses: none, query: "5" })).toHaveLength(0);
  });
});

describe("status filter", () => {
  it("multiple statuses match with OR", () => {
    const rows = filterLeads(LEADS, { statuses: new Set(["signed", "opportunity"]), query: "" });
    expect(rows.map((r) => r.status)).toEqual(["signed", "opportunity", "opportunity"]);
  });

  it("combines with the search using AND", () => {
    const rows = filterLeads(LEADS, { statuses: new Set(["pending"]), query: "adams" });
    expect(names(rows)).toEqual(["Dan Adams"]);
    expect(filterLeads(LEADS, { statuses: new Set(["signed"]), query: "brown" })).toEqual([]);
  });

  it("no status selected means no status restriction", () => {
    expect(filterLeads(LEADS, { statuses: none, query: "" })).toHaveLength(5);
    expect(isFiltered({ statuses: none, query: "" })).toBe(false);
    expect(isFiltered({ statuses: new Set(["signed"]), query: "" })).toBe(true);
    expect(isFiltered({ statuses: none, query: " x " })).toBe(true);
  });
});

describe("live counts", () => {
  it("count every loaded lead by status when nothing is searched", () => {
    expect(statusFacets(LEADS, "")).toEqual({ signed: 1, pending: 2, opportunity: 2 });
  });

  it("follow the search, but not the status filter itself (shadcn's faceting rule)", () => {
    expect(statusFacets(LEADS, "adams")).toEqual({ signed: 1, pending: 1, opportunity: 0 });
  });
});

// ---------------------------------------------------------------------------
// Rendered markup
// ---------------------------------------------------------------------------
const portalLead = (id: string, name: string, status: PortalStatusLabel, extra: Record<string, unknown> = {}): PortalLead =>
  ({
    id,
    date: "2026-10-10",
    name,
    phone: "+15551234567",
    status,
    signedDate: status === "signed" ? "2026-10-11" : null,
    firmNote: null,
    staffNote: null,
    ...extra,
  }) as PortalLead;

function render(leads: PortalLead[]) {
  return renderToStaticMarkup(
    createElement(LeadsView, { leads, monthLabel: "October 2026", noteMaxLength: 2000 }),
  );
}

describe("the filter in the page", () => {
  const leads = [
    portalLead("11111111-1111-4111-8111-111111111111", "Sam Signed", "signed"),
    portalLead("22222222-2222-4222-8222-222222222222", "Pat Pending", "pending"),
    portalLead("33333333-3333-4333-8333-333333333333", "Pia Pending", "pending"),
    portalLead("44444444-4444-4444-8444-444444444444", "Oli Opportunity", "opportunity"),
  ];

  it("renders the search box, the Status trigger and a closed popover", () => {
    const html = render(leads);
    expect(html).toContain('placeholder="Search name or phone"');
    expect(html).toMatch(/aria-haspopup="dialog" aria-expanded="false"[^>]*>.*Status/);
    expect(html).toMatch(/role="dialog"[^>]*hidden=""/);
    // Nothing selected yet: no badge, no clear button, no reset.
    expect(html).not.toContain("selected</span>");
    expect(html).not.toContain("Clear filters");
    expect(html).not.toContain(">Reset");
  });

  it("each option shows its live count over the loaded rows", () => {
    const html = render(leads);
    const count = (s: string) => html.match(new RegExp(`data-facet-count="${s}"[^>]*>(\\d+)<`))?.[1];
    expect([count("signed"), count("pending"), count("opportunity")]).toEqual(["1", "2", "1"]);
    expect(html).toMatch(/role="listbox" aria-multiselectable="true"/);
    expect((html.match(/role="option" aria-selected="false"/g) ?? []).length).toBe(3);
  });

  it("each option uses the same status badge as the table", () => {
    const html = render(leads);
    const list = html.slice(html.indexOf('role="listbox"'), html.indexOf("</ul>", html.indexOf('role="listbox"')));
    for (const s of ["signed", "pending", "opportunity"]) {
      expect(list).toContain(`class="portal-status portal-status-${s}"`);
    }
  });

  it("with no filter, every loaded lead is shown in both the table and the phone cards", () => {
    const html = render(leads);
    for (const l of leads) expect(html.split(l.name!).length - 1).toBe(2);
  });

  it("renders nothing beyond the client-facing fields, even if a row carried more", () => {
    const leaky = portalLead("55555555-5555-4555-8555-555555555555", "Leaky Lead", "pending", {
      source: "SECRET-SOURCE",
      channel: "SECRET-CHANNEL",
      tags: ["SECRET-TAG"],
      rawNote: "SECRET-CALLRAIL-NOTE",
      statusTagMatched: "SECRET-MATCHED",
    });
    const html = render([leaky]);
    expect(html).toContain("Leaky Lead");
    expect(html).not.toContain("SECRET");
  });
});

// ---------------------------------------------------------------------------
// Popover close rule (the cause of the filter not filtering) and the note
// field's rules. Logic only: the repo has no DOM test environment, so the
// actual click and keypress paths are NOT exercised here.
// ---------------------------------------------------------------------------
import { closesOnFocusOut } from "@/app/(portal)/_lib/popover";
import { noteDraftState, revertedDraft } from "@/app/(portal)/_lib/note-editor";

describe("popover focus-out rule", () => {
  const inside = { id: "inside" };
  const container = { contains: (n: unknown) => n === inside };

  it("does NOT close when focus goes nowhere (a press on an option row, or a button in Safari)", () => {
    expect(closesOnFocusOut(container, null)).toBe(false);
    expect(closesOnFocusOut(container, undefined)).toBe(false);
  });

  it("does not close when focus moves to something inside", () => {
    expect(closesOnFocusOut(container, inside)).toBe(false);
  });

  it("closes when focus moves to something outside (Tab away)", () => {
    expect(closesOnFocusOut(container, { id: "elsewhere" })).toBe(true);
  });
});

describe("note field rules", () => {
  it("unchanged text is not dirty and cannot save", () => {
    expect(noteDraftState("Hello", "Hello", 2000)).toEqual({ dirty: false, canSave: false });
    expect(noteDraftState("Hello", "  Hello  ", 2000)).toEqual({ dirty: false, canSave: false });
  });

  it("changed text can save", () => {
    expect(noteDraftState("Hello", "Hello there", 2000)).toEqual({ dirty: true, canSave: true });
    expect(noteDraftState("", "First", 2000)).toEqual({ dirty: true, canSave: true });
  });

  it("clearing the field is dirty but never saves — it is never a deletion", () => {
    expect(noteDraftState("Hello", "", 2000)).toEqual({ dirty: true, canSave: false });
    expect(noteDraftState("Hello", "   ", 2000)).toEqual({ dirty: true, canSave: false });
  });

  it("over the cap cannot save", () => {
    expect(noteDraftState("", "x".repeat(2001), 2000).canSave).toBe(false);
    expect(noteDraftState("", "x".repeat(2000), 2000).canSave).toBe(true);
  });

  it("cancel reverts to exactly the saved note", () => {
    expect(revertedDraft("Saved text")).toBe("Saved text");
    expect(noteDraftState("Saved text", revertedDraft("Saved text"), 2000).dirty).toBe(false);
  });
});
