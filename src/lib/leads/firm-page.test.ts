// The redesigned admin firm page: the status counts (and that "visible now"
// is the portal's own rule), the steps, the strip, the collapsed sections,
// Sync now, the Active switch and the company picker's rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  buildQueueCountQuery,
  buildVisibleNowCandidatesQuery,
  countVisibleNow,
  portalWindowNow,
  type VisibilityFacts,
} from "@/app/admin/firms/[id]/_lib/firm-status";
import { inRange, isClientVisible, monthAnchor } from "@/lib/portal/visibility";
import { FirmStep } from "@/components/leads/firm-step";
import { FirmStatusStrip, statusTiles } from "@/components/leads/firm-status-strip";
import { FirmSyncStep, firmSyncUrl, summarise } from "@/components/leads/firm-sync-step";
import { FirmHeader, deactivateConfirmText } from "@/components/leads/firm-header";
import {
  availability,
  filterCompanies,
  looksLikeCompanyId,
  pickerOptions,
  type PickerCompany,
} from "@/components/leads/callrail-company-picker";
import { FirmButton, firmButtonClasses } from "@/components/leads/firm-button";

// A connectionless Drizzle instance: toSQL() compiles the real builders without a socket.
const compileDb = drizzle({} as never, { schema }) as never;
const FIRM = "11111111-1111-4111-8111-111111111111";
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00Z")); // Oct 15 2026, Eastern
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------------------
// "Visible now"
// ---------------------------------------------------------------------------

const lead = (over: Partial<VisibilityFacts> = {}): VisibilityFacts => ({
  effectiveStatus: "pending",
  effectiveOpportunity: true,
  needsReview: false,
  hasStatusOverride: false,
  statusTagMatched: null,
  occurredAt: new Date("2026-10-10T15:00:00Z"),
  signedAt: null,
  ...over,
});

const SAMPLES: [string, VisibilityFacts, boolean][] = [
  ["an opportunity this month", lead(), true],
  ["an opportunity last month", lead({ occurredAt: new Date("2026-09-03T15:00:00Z") }), true],
  ["an opportunity two months ago", lead({ occurredAt: new Date("2026-08-20T15:00:00Z") }), false],
  ["Aug 31 23:30 Eastern — still August", lead({ occurredAt: new Date("2026-09-01T03:30:00Z") }), false],
  ["Sep 1 00:10 Eastern — in the window", lead({ occurredAt: new Date("2026-09-01T04:10:00Z") }), true],
  ["a pending lead that is not an opportunity", lead({ effectiveOpportunity: false, statusTagMatched: "Pending" }), false],
  ["needs review", lead({ needsReview: true }), false],
  ["hidden by a Lost tag", lead({ statusTagMatched: "Lost" }), false],
  ["Lost, but staff overrode the status to signed", lead({ statusTagMatched: "Lost", hasStatusOverride: true, effectiveStatus: "signed", signedAt: new Date("2026-10-11T15:00:00Z") }), true],
  ["called in August, signed Sep 3 — belongs to September", lead({ effectiveStatus: "signed", effectiveOpportunity: false, statusTagMatched: "Signed", occurredAt: new Date("2026-08-28T15:00:00Z"), signedAt: new Date("2026-09-03T15:00:00Z") }), true],
  ["called and signed in August", lead({ effectiveStatus: "signed", effectiveOpportunity: false, statusTagMatched: "Signed", occurredAt: new Date("2026-08-10T15:00:00Z"), signedAt: new Date("2026-08-30T15:00:00Z") }), false],
];

describe("visible now = the portal's rule, this month + last month", () => {
  it("the window is Sep 1 to the end of today (Oct 15), Eastern", () => {
    const w = portalWindowNow();
    expect(w.start.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(w.endExclusive.toISOString()).toBe("2026-10-16T04:00:00.000Z");
  });

  it.each(SAMPLES)("%s → %s", (_, facts, expected) => {
    expect(countVisibleNow([facts])).toBe(expected ? 1 : 0);
  });

  it("over all the samples, matches the portal's own functions one by one", () => {
    const w = portalWindowNow();
    const portalSays = SAMPLES.filter(([, f]) =>
      isClientVisible(f) && inRange(monthAnchor({ effectiveStatus: f.effectiveStatus, signedAt: f.signedAt, occurredAt: f.occurredAt }), w),
    ).length;
    expect(countVisibleNow(SAMPLES.map(([, f]) => f))).toBe(portalSays);
    expect(portalSays).toBe(SAMPLES.filter(([, , e]) => e).length);
  });

  it("the candidate query is scoped to this firm and to calls or signings in the window", () => {
    const q = buildVisibleNowCandidatesQuery(compileDb, FIRM, portalWindowNow()).toSQL();
    expect(q.sql).toMatch(/"leads"\."firm_id" = \$1 and "leads"\."occurred_at" < \$2 and \("leads"\."occurred_at" >= \$3 or "leads"\."signed_at" >= \$4\)/);
    expect(q.params[0]).toBe(FIRM);
  });

  it("the queue count is this firm's rows only, under the admin queue's own condition", () => {
    const q = buildQueueCountQuery(compileDb, FIRM).toSQL();
    expect(q.sql).toMatch(/^select count\(\*\) from "leads" where \("leads"\."firm_id" = \$1 and \(/);
    expect(q.sql).toMatch(/"leads"\."needs_review" = \$\d+ or "leads"\."firm_id" is null or "leads"\."parse_failed" = \$\d+ or "leads"\."possible_duplicate_of" is not null/);
    expect(q.params[0]).toBe(FIRM);
  });
});

// ---------------------------------------------------------------------------
// Steps and the status strip
// ---------------------------------------------------------------------------

describe("steps", () => {
  it.each([
    [true, "done", ">Done<"],
    [false, "todo", ">Not done<"],
  ])("done=%s shows %s", (done, state, label) => {
    const html = renderToStaticMarkup(createElement(FirmStep, { n: 1, title: "CallRail company", hint: "One line.", done }, "body"));
    expect(html).toContain(`data-step-state="${state}"`);
    expect(html).toContain(label);
    expect(html).toContain("One line.");
  });
});

describe("status strip", () => {
  it("replaces the warnings: not-mapped and no-login read as to-do", () => {
    expect(statusTiles({ companiesMapped: 0, activeLogins: 0, leadsSynced: 0, visibleNow: 0, inQueue: 0 }).map((t) => [t.key, t.value, t.tone])).toEqual([
      ["company", "Not mapped", "todo"],
      ["logins", "None", "todo"],
      ["synced", "0", "plain"],
      ["visible", "0", "plain"],
      ["queue", "0", "plain"],
    ]);
  });

  it("shows the counts, and links the queue", () => {
    const html = renderToStaticMarkup(
      createElement(FirmStatusStrip, { status: { companiesMapped: 1, activeLogins: 2, leadsSynced: 24, visibleNow: 9, inQueue: 3 } }),
    );
    for (const s of ["1 mapped", "2 active", ">24<", ">9<", ">3<"]) expect(html).toContain(s);
    expect(html).toMatch(/data-tile="queue"[^>]*><a href="\/admin\/leads\/queue"/);
  });
});

// ---------------------------------------------------------------------------
// Sync now, the Active switch, collapsed sections
// ---------------------------------------------------------------------------

describe("Sync now", () => {
  it("calls the existing staff sync route with this firm's company ids", () => {
    expect(firmSyncUrl(["COM1", "COM2"])).toBe("/api/admin/leads/sync-now?companyIds=COM1%2CCOM2");
  });

  it("is disabled until a company is mapped", () => {
    const html = renderToStaticMarkup(createElement(FirmSyncStep, { firmId: FIRM, companyIds: [], queueCount: 0 }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sync now</);
    expect(html).toContain("Map a CallRail company first.");
    expect(html).toContain(`href="/admin/leads?firm=${FIRM}"`);
  });

  it("summarises a result in one line", () => {
    const src = { fetched: 10, written: 3, parseFailed: 1, error: null };
    expect(summarise({ calls: src, forms: { ...src, fetched: 2, written: 1, parseFailed: 0 } })).toBe(
      "12 fetched · 4 written · 1 couldn't be read",
    );
  });
});

describe("the Active switch and the details form", () => {
  it("renders as a switch reflecting the firm's state", () => {
    const html = renderToStaticMarkup(createElement(FirmHeader, { firm: { id: FIRM, name: "Smith Law", slug: "smith-law", isActive: true } }));
    expect(html).toMatch(/role="switch" aria-checked="true"/);
    expect(html).toContain("Smith Law");
  });

  it("deactivation asks first; the confirm text names the firm", () => {
    expect(deactivateConfirmText("Smith Law")).toMatch(/^Deactivate Smith Law\? Its clients lose portal access/);
  });

  it("the details form no longer sends isActive, so it can never undo the switch", () => {
    const src = read("src", "components", "leads", "firm-details-card.tsx");
    expect(src).toContain("JSON.stringify({ name, slug })");
    expect(src).not.toMatch(/isActive\s*[,}]/);
  });
});

describe("collapsed sections", () => {
  const page = read("src", "app", "admin", "firms", "[id]", "page.tsx");
  it.each(["advanced", "danger"])("%s renders closed by default", (section) => {
    const tag = page.match(new RegExp(`<details[^>]*data-section="${section}"[^>]*>`))?.[0] ?? "";
    expect(tag).not.toBe("");
    expect(tag).not.toMatch(/\bopen\b/);
  });

  it("the old warning boxes are gone", () => {
    const list = read("src", "components", "leads", "firm-string-list-card.tsx");
    expect(list).not.toMatch(/amber-|bg-yellow/);
  });
});

// ---------------------------------------------------------------------------
// The company picker's rules
// ---------------------------------------------------------------------------

describe("company picker", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const list: PickerCompany[] = [
    { id: "COM1", name: "Smith Law PPC", disabled: false, mappedTo: null },
    { id: "COM2", name: "Jones Injury", disabled: false, mappedTo: { firmId: OTHER, firmName: "Jones" } },
    { id: "COM3", name: "Smith Law GMB", disabled: false, mappedTo: { firmId: FIRM, firmName: "Smith Law" } },
    { id: "COM4", name: "Old account", disabled: true, mappedTo: null },
  ];

  it("only an unmapped, enabled company can be added; the others say why", () => {
    expect(list.map((c) => availability(c, FIRM).kind)).toEqual(["free", "elsewhere", "here", "disabled"]);
  });

  it("searches by name or id, ignoring case", () => {
    expect(filterCompanies(list, "smith").map((c) => c.id)).toEqual(["COM1", "COM3"]);
    expect(filterCompanies(list, "com4").map((c) => c.id)).toEqual(["COM4"]);
    expect(filterCompanies(list, "  ")).toHaveLength(4);
  });

  it("is one field: no separate paste box or 'Choose from CallRail' button for companies", () => {
    const list = read("src", "components", "leads", "firm-string-list-card.tsx");
    expect(list).toMatch(/picker && kind === "companies" \? \(\s*<CallRailCompanyField firmId=\{firmId\} onPick=\{addValue\} \/>\s*\) : \(\s*<form/);
    const field = read("src", "components", "leads", "callrail-company-picker.tsx");
    expect(field).not.toContain("Choose from CallRail");
    expect(field).not.toContain("paste a company id");
  });

  it("loads on first focus (never on page load), and keeps focus when a row is pressed", () => {
    const field = read("src", "components", "leads", "callrail-company-picker.tsx");
    expect(field).toMatch(/function openList\(\) \{[\s\S]*if \(!list && !loading && !loadError\) void load\(\);/);
    expect(field).toMatch(/onFocus=\{openList\}/);
    expect(field).not.toMatch(/useEffect\(\(\) => \{?\s*(void )?load\(/);
    expect(field).toMatch(/role="option"[\s\S]*onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
    expect(field.match(/fetch\(/g)).toHaveLength(1);
  });

  it("after a pick: confirmed, cleared and closed", () => {
    const field = read("src", "components", "leads", "callrail-company-picker.tsx");
    expect(field).toMatch(/setConfirmed\(\{ id, name \}\);\s*setQuery\(""\);\s*setOpen\(false\);/);
  });
});

describe("the combined company field", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const ID_A = "COM0123456789abcdef0123456789abcdef";
  const list: PickerCompany[] = [
    { id: ID_A, name: "Smith Law PPC", disabled: false, mappedTo: null },
    { id: "COMbbbbbbbbbbbb", name: "Jones Injury", disabled: false, mappedTo: { firmId: OTHER, firmName: "Jones" } },
  ];
  const view = (o: ReturnType<typeof pickerOptions>[number]) =>
    o.kind === "pasted" ? ["pasted", o.id, o.pickable] : ["company", o.company.id, o.pickable, o.note];

  it("typing searches by name", () => {
    expect(pickerOptions(list, "smith", FIRM).map(view)).toEqual([["company", ID_A, true, null]]);
  });

  it("an exact pasted id that is in the list shows as that company", () => {
    expect(pickerOptions(list, ID_A, FIRM).map(view)).toEqual([["company", ID_A, true, null]]);
  });

  it("a company taken by another firm shows as taken and cannot be picked — even pasted", () => {
    expect(pickerOptions(list, "COMbbbbbbbbbbbb", FIRM).map(view)).toEqual([["company", "COMbbbbbbbbbbbb", false, "Taken by Jones"]]);
  });

  it("an id not in the list can still be used", () => {
    expect(pickerOptions(list, "COMcccccccccccc", FIRM).map(view)).toEqual([["pasted", "COMcccccccccccc", true]]);
  });

  it("if CallRail failed (no list), a pasted id still works — never blocked", () => {
    expect(pickerOptions(null, "  COM0123456789abcdef  ", FIRM).map(view)).toEqual([["pasted", "COM0123456789abcdef", true]]);
    expect(pickerOptions(null, "smith", FIRM)).toEqual([]);
  });

  it("recognises a CallRail company id", () => {
    expect(looksLikeCompanyId("COM8a3f12ab")).toBe(true);
    expect(looksLikeCompanyId("com8a3f12ab")).toBe(true);
    expect(looksLikeCompanyId("Smith")).toBe(false);
    expect(looksLikeCompanyId("COM1")).toBe(false);
  });
});

describe("one shared button", () => {
  it("danger carries exactly the requested classes", () => {
    const c = firmButtonClasses("danger");
    for (const k of "rounded-xl bg-gradient-to-t from-red-600 to-red-500 px-4 py-2 text-sm font-medium text-white".split(" ")) {
      expect(c.split(" ")).toContain(k);
    }
  });

  it("primary carries the requested classes as the dark look, with a light-mode pair", () => {
    const c = firmButtonClasses("primary").split(" ");
    for (const k of ["py-2", "px-4", "rounded-xl", "text-sm", "font-medium", "border"]) expect(c).toContain(k);
    for (const k of ["dark:bg-emerald-950", "dark:text-emerald-500", "dark:border-emerald-900"]) expect(c).toContain(k);
    for (const k of ["bg-emerald-50", "text-emerald-800", "border-emerald-200"]) expect(c).toContain(k);
  });

  it("both have hover, keyboard focus and disabled states", () => {
    for (const v of ["danger", "primary"] as const) {
      const c = firmButtonClasses(v);
      expect(c).toMatch(/hover:/);
      expect(c).toContain("focus-visible:ring-2");
      expect(c).toContain("disabled:opacity-50");
      expect(c).toContain("disabled:cursor-not-allowed");
    }
  });

  it("Create login, Sync now and Delete firm all use it; nothing copies the classes", () => {
    expect(read("src", "components", "leads", "firm-users-card.tsx")).toContain('<FirmButton type="submit" variant="primary"');
    expect(read("src", "components", "leads", "firm-sync-step.tsx")).toContain('<FirmButton variant="primary"');
    expect(read("src", "components", "leads", "firm-danger-zone-card.tsx")).toContain('<FirmButton variant="danger"');
    for (const f of ["firm-users-card.tsx", "firm-sync-step.tsx", "firm-danger-zone-card.tsx", "firm-header.tsx", "callrail-company-picker.tsx"]) {
      expect(read("src", "components", "leads", f), f).not.toMatch(/from-red-600|bg-emerald-950/);
    }
  });

  it("Delete firm stays disabled until the name is typed", async () => {
    const { FirmDangerZoneCard } = await import("@/components/leads/firm-danger-zone-card");
    const html = renderToStaticMarkup(createElement(FirmDangerZoneCard, { firmId: FIRM, firmName: "Smith Law", leadCount: 0 }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Delete firm<\/button>/);
    expect(renderToStaticMarkup(createElement(FirmButton, { variant: "danger", disabled: true }, "x"))).toContain('type="button"');
  });
});
