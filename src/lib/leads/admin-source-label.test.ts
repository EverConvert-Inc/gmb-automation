// A text lead is labelled "Text" under its date on every admin page that
// lists leads: /admin/leads and /admin/leads/queue (both render
// AdminLeadsTable). Faked: the staff check and the admin queries.
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminLeadRow } from "./queries-admin";

function row(source: string, callrailId: string): AdminLeadRow {
  return {
    id: `id-${callrailId}`,
    firmId: null,
    firmName: null,
    source,
    callrailId,
    personSuffix: "p1",
    occurredAt: new Date("2026-10-14T15:00:00Z"),
    name: null,
    phone: null,
    status: "pending",
    isOpportunity: false,
    nameParsed: null,
    phoneParsed: null,
    statusParsed: "pending",
    statusOverride: null,
    isOpportunityParsed: false,
    isOpportunityOverride: null,
    statusTagMatched: null,
    rawSourceName: null,
    signedAt: null,
    suggestedStatus: null,
    suggestedStatusSeenAt: null,
    needsReview: true,
    parseFailed: true,
    parseError: "no_phone",
    possibleDuplicateOf: null,
    latestNote: null,
  };
}

const ROWS = [row("text", "CON0abc:SMT01abc"), row("call", "CAL0abc"), row("form", "FRM0abc")];

vi.mock("@/lib/leads/admin-auth", () => ({ checkAdmin: async () => ({ ok: true, email: "s@everconvert.com" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/admin/leads", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
vi.mock("@/lib/leads/queries-admin", () => ({
  ADMIN_LEAD_LIMIT: 500,
  listAdminLeads: async () => ROWS,
  listAdminQueue: async () => ROWS.map((r) => ({ ...r, reason: "parse_failure" })),
  listFirmOptions: async () => [],
  countAdminQueue: async () => ROWS.length,
  listHiddenByNameCandidates: async () => [],
}));

/** The source line under each row's date, in row order. */
function sourceLabels(html: string): string[] {
  return [...html.matchAll(/<div class="text-xs">([^<]*)<\/div>/g)].map((m) => m[1]);
}

describe("admin source labels", () => {
  it("/admin/leads labels a text lead Text", async () => {
    const { default: Page } = await import("@/app/admin/leads/page");
    const html = renderToStaticMarkup((await Page({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(sourceLabels(html)).toEqual(["Text", "Call", "Form"]);
  });

  it("/admin/leads/queue labels a text lead Text", async () => {
    const { default: Page } = await import("@/app/admin/leads/queue/page");
    const html = renderToStaticMarkup((await Page()) as ReactElement);
    expect(sourceLabels(html)).toEqual(["Text", "Call", "Form"]);
  });
});
