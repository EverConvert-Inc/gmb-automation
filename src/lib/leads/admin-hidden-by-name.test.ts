// "Hidden from clients: no usable name" — the admin list and the Leads tab
// badge use the portal's own rule, so they cannot drift from what a client sees.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

const h = vi.hoisted(() => ({ candidates: [] as unknown[], denied: null as Response | null }));

vi.mock("@/lib/leads/queries-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/leads/queries-admin")>()),
  listHiddenByNameCandidates: async () => h.candidates,
}));
vi.mock("@/lib/leads/admin-auth", () => ({ requireAdminRoute: async () => h.denied }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/leads" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));

import { buildHiddenByNameCandidatesQuery, HIDDEN_NAME_EXPR, type AdminLeadRow } from "@/lib/leads/queries-admin";
import { countVisibleNow, isHiddenByNameNow, portalWindowNow, type VisibilityFacts } from "@/app/admin/firms/[id]/_lib/firm-status";
import { groupByFirm, listHiddenByName } from "@/app/admin/leads/hidden/_lib/hidden";
import { GET as hiddenCount } from "@/app/api/admin/leads/hidden-count/route";
import { AdminTabsView } from "@/components/leads/admin-tabs";
import { hasUsableName, unusableNameSql } from "@/lib/portal/usable-name";
import { inRange, isClientVisible, monthAnchor } from "@/lib/portal/visibility";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
  h.candidates = [];
  h.denied = null;
});
afterEach(() => vi.useRealTimers());

const facts = (over: Partial<VisibilityFacts> = {}): VisibilityFacts => ({
  effectiveStatus: "pending",
  effectiveOpportunity: true,
  needsReview: false,
  hasStatusOverride: false,
  statusTagMatched: null,
  occurredAt: new Date("2026-10-10T15:00:00Z"),
  signedAt: null,
  name: "No Name",
  hasNameOverride: false,
  ...over,
});

const MATRIX: VisibilityFacts[] = [];
for (const name of ["No Name", "no name.", "", null, "5551234567", "Google Local Services Ads", "Jane Doe"]) {
  for (const hasNameOverride of [false, true]) {
    for (const extra of [
      {},
      { effectiveStatus: "signed", signedAt: new Date("2026-10-11T15:00:00Z") },
      { effectiveOpportunity: false, statusTagMatched: "Pending" },
      { needsReview: true },
      { statusTagMatched: "Lost" },
      { occurredAt: new Date("2026-08-10T15:00:00Z") },
    ] as Partial<VisibilityFacts>[]) {
      MATRIX.push(facts({ name, hasNameOverride, ...extra }));
    }
  }
}

describe("the rule is the portal's", () => {
  const w = portalWindowNow();
  const portalShowsButForName = (f: VisibilityFacts) =>
    isClientVisible(f) && inRange(monthAnchor({ effectiveStatus: f.effectiveStatus, signedAt: f.signedAt, occurredAt: f.occurredAt }), w);

  it.each(MATRIX.map((f, i) => [i, f] as const))("case %i: hidden-by-name = the portal's rules pass but the name fails", (_, f) => {
    expect(isHiddenByNameNow(f, w)).toBe(portalShowsButForName(f) && !hasUsableName(f));
  });

  it("every lead is visible, hidden by name, or neither — never both", () => {
    for (const f of MATRIX) {
      const visible = countVisibleNow([f], w) === 1;
      const hidden = isHiddenByNameNow(f, w);
      expect(visible && hidden).toBe(false);
      expect(visible || hidden).toBe(portalShowsButForName(f));
    }
  });

  it("a staff-typed name is never hidden", () => {
    for (const f of MATRIX.filter((m) => m.hasNameOverride)) expect(isHiddenByNameNow(f, w)).toBe(false);
  });
});

describe("the candidate query", () => {
  const db = drizzle({} as never, { schema });
  const { sql: text } = buildHiddenByNameCandidatesQuery(db, portalWindowNow()).toSQL();

  it("narrows with the portal's own name SQL, over the effective name", () => {
    expect(text).toContain(unusableNameSql(HIDDEN_NAME_EXPR));
    expect(HIDDEN_NAME_EXPR).toBe('coalesce("leads"."name_override", "leads"."name_parsed")');
  });

  it("skips staff-typed names, unassigned rows and rows under review", () => {
    expect(text).toContain(`("leads"."name_override" is null or btrim("leads"."name_override") = '')`);
    expect(text).toContain('"leads"."firm_id" is not null');
    expect(text).toContain('"leads"."needs_review" = $');
  });
});

const row = (over: Partial<AdminLeadRow> & { nameOverride?: string | null } = {}) => ({
  id: "r1",
  firmId: "f1",
  firmName: "Smith Law",
  source: "call",
  callrailId: "CAL1",
  personSuffix: "p1",
  occurredAt: new Date("2026-10-10T15:00:00Z"),
  name: "No Name",
  phone: "555-123-4567",
  status: "pending",
  isOpportunity: true,
  nameParsed: "No Name",
  phoneParsed: "555-123-4567",
  statusParsed: "pending",
  statusOverride: null,
  isOpportunityParsed: true,
  isOpportunityOverride: null,
  statusTagMatched: null,
  rawSourceName: "Google Local Services Ads",
  signedAt: null,
  suggestedStatus: null,
  suggestedStatusSeenAt: null,
  needsReview: false,
  parseFailed: false,
  parseError: null,
  possibleDuplicateOf: null,
  latestNote: null,
  nameOverride: null,
  ...over,
});

describe("listHiddenByName", () => {
  it("keeps only what the portal hides for the name alone", async () => {
    h.candidates = [
      row({ id: "hidden" }),
      row({ id: "lost-tag", statusTagMatched: "Lost" }),
      row({ id: "two-months-ago", occurredAt: new Date("2026-08-10T15:00:00Z") }),
      row({ id: "real-name", name: "Jane Doe", nameParsed: "Jane Doe" }),
      row({ id: "staff-named", name: "Jane Fixed", nameOverride: "Jane Fixed" }),
      row({ id: "phone-name", firmId: "f2", firmName: "Other Law", name: "5551234567", nameParsed: "5551234567" }),
    ];
    const rows = await listHiddenByName();
    expect(rows.map((r) => r.id)).toEqual(["hidden", "phone-name"]);
    expect(rows.every((r) => !("nameOverride" in r))).toBe(true);
    expect(groupByFirm(rows).map((g) => [g.firmName, g.rows.length])).toEqual([
      ["Smith Law", 1],
      ["Other Law", 1],
    ]);
  });
});

describe("the Leads tab badge", () => {
  it("shows the hidden count on the Leads tab only", () => {
    const html = renderToStaticMarkup(createElement(AdminTabsView, { pathname: "/admin/leads", hiddenCount: 3 }));
    const leadsTab = html.slice(html.indexOf('href="/admin/leads"'), html.indexOf('href="/admin/leads/queue"'));
    expect(leadsTab).toMatch(/>3<\/span>/);
    expect(leadsTab).toContain('title="3 hidden from clients: no usable name"');
    expect(html.match(/>3<\/span>/g)).toHaveLength(1);
  });

  it("no badge at zero", () => {
    const html = renderToStaticMarkup(createElement(AdminTabsView, { pathname: "/admin/leads", hiddenCount: 0 }));
    expect(html).not.toContain("hidden from clients");
  });

  it("its count route is staff-only and counts the same list", async () => {
    h.candidates = [row({ id: "a" }), row({ id: "b", name: "Jane Doe", nameParsed: "Jane Doe" })];
    const res = await hiddenCount();
    expect(await res.json()).toEqual({ hidden: 1 });
    h.denied = new Response("no", { status: 403 });
    expect((await hiddenCount()).status).toBe(403);
  });
});
