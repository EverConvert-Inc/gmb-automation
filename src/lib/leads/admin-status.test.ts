// Admin status display = the portal's own label, or the rejection-style tag
// that hides the lead from the client. Never the raw stored 'pending'.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));

import { adminStatusView, fromTagsStatusText } from "@/components/leads/admin-status";
import { AdminLeadsTable } from "@/components/leads/admin-leads-table";
import { HIDDEN_TAGS, isClientVisible, portalStatusLabel } from "@/lib/portal/visibility";
import type { AdminLeadRow } from "./queries-admin";

const TAGS = [null, "Pending", "Signed", "Opportunity", "Retained", ...HIDDEN_TAGS];
const CASES: { status: string; statusOverride: string | null; statusTagMatched: string | null }[] = [];
for (const statusTagMatched of TAGS) {
  for (const [status, statusOverride] of [["pending", null], ["signed", null], ["pending", "pending"], ["signed", "signed"]] as const) {
    CASES.push({ status, statusOverride, statusTagMatched });
  }
}

describe("adminStatusView is the portal's reading", () => {
  it.each(CASES.map((c) => [c.statusTagMatched, c.status, c.statusOverride, c] as const))(
    "tag %s, status %s, override %s",
    (_t, _s, _o, c) => {
      const v = adminStatusView(c);
      const hasStatusOverride = c.statusOverride !== null;
      // Hidden exactly when the portal's isClientVisible rejects it for the tag alone.
      const portalHidesForTag = !isClientVisible({
        effectiveStatus: "signed", effectiveOpportunity: true, needsReview: false, hasStatusOverride, statusTagMatched: c.statusTagMatched,
      });
      expect(v.kind === "hidden").toBe(portalHidesForTag);
      if (v.kind === "label") {
        expect(v.label).toBe(portalStatusLabel({ effectiveStatus: c.status, hasStatusOverride, statusTagMatched: c.statusTagMatched }));
      } else {
        expect(v.tag).toBe(c.statusTagMatched);
      }
    },
  );

  it("Opportunity + No Case with no Pending tag is No Case, not Pending", () => {
    expect(adminStatusView({ status: "pending", statusOverride: null, statusTagMatched: "No Case" })).toEqual({ kind: "hidden", tag: "No Case" });
  });

  it("an override un-hides and decides the label", () => {
    expect(adminStatusView({ status: "pending", statusOverride: "pending", statusTagMatched: "No Case" })).toEqual({ kind: "label", label: "pending", text: "Pending" });
    expect(adminStatusView({ status: "signed", statusOverride: "signed", statusTagMatched: "Lost" })).toMatchObject({ label: "signed" });
  });

  it("the drawer's From-tags text", () => {
    expect(fromTagsStatusText({ statusParsed: "pending", statusTagMatched: "Declined" })).toBe("Declined, hidden from client");
    expect(fromTagsStatusText({ statusParsed: "pending", statusTagMatched: "Pending" })).toBe("Pending");
    expect(fromTagsStatusText({ statusParsed: "pending", statusTagMatched: null })).toBe("Opportunity");
    expect(fromTagsStatusText({ statusParsed: "signed", statusTagMatched: "Signed" })).toBe("Signed");
  });
});

const row = (over: Partial<AdminLeadRow>): AdminLeadRow => ({
  id: `id-${Math.random()}`,
  firmId: "f1",
  firmName: "Smith Law",
  source: "call",
  callrailId: "CAL1",
  personSuffix: "p1",
  occurredAt: new Date("2026-10-10T15:00:00Z"),
  name: "Jane Doe",
  phone: "555-123-4567",
  status: "pending",
  isOpportunity: true,
  nameParsed: "Jane Doe",
  phoneParsed: "555-123-4567",
  statusParsed: "pending",
  statusOverride: null,
  isOpportunityParsed: true,
  isOpportunityOverride: null,
  statusTagMatched: null,
  rawSourceName: null,
  signedAt: null,
  suggestedStatus: null,
  suggestedStatusSeenAt: null,
  needsReview: false,
  parseFailed: false,
  parseError: null,
  possibleDuplicateOf: null,
  latestNote: null,
  ...over,
});

/** The visible text of each row's Status cell (5th column). */
function statusCells(rows: AdminLeadRow[]): string[] {
  const html = renderToStaticMarkup(createElement(AdminLeadsTable, { rows, emptyMessage: "" }));
  const body = html.slice(html.indexOf("<tbody"));
  return body
    .split(/<tr\b/)
    .slice(1)
    .map((tr) => (tr.split(/<td\b/)[5] ?? "").replace(/<[^>]*>/g, " ").replace(/^[^>]*>/, "").replace(/\s+/g, " ").trim());
}

describe("the admin table (leads, queue, hidden) Status column", () => {
  it("shows the portal's label, and a hidden tag as the tag with a note", () => {
    expect(
      statusCells([
        row({ statusTagMatched: "No Case" }),
        row({ statusTagMatched: "Pending" }),
        row({ statusTagMatched: null }),
        row({ status: "signed", statusParsed: "signed", statusTagMatched: "Signed" }),
        row({ status: "pending", statusOverride: "pending", statusTagMatched: "Lost" }),
        row({ statusTagMatched: "Referred out", isOpportunity: false }),
      ]),
    ).toEqual([
      "No Case Hidden from client",
      "Pending Opportunity",
      "Opportunity",
      "Signed Opportunity",
      "Pending Opportunity (set by admin)",
      "Referred out Hidden from client",
    ]);
  });

  it("never reads a rejection-tagged lead as Pending", () => {
    for (const tag of HIDDEN_TAGS) {
      expect(statusCells([row({ statusTagMatched: tag })])[0]).toBe(`${tag} Hidden from client`);
    }
  });
});
