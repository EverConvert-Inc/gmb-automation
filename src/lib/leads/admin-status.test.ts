// Admin status display = what the client sees, by the portal's own rule
// (clientVisibility): Signed or Pending when shown, the negative tags holding
// it back, Opportunity-only waiting for approval, or under review.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));

import { adminStatusView, fromTagsStatusText } from "@/components/leads/admin-status";
import { AdminLeadsTable } from "@/components/leads/admin-leads-table";
import { clientVisibility, negativeTagsOf } from "@/lib/portal/visibility";
import type { AdminLeadRow } from "./queries-admin";

const SIX = ["Lost", "Rejected", "No Case", "Referred out", "No Contact", "Declined"];
type Case = Pick<AdminLeadRow, "status" | "statusOverride" | "statusTagMatched" | "needsReview" | "rawTags" | "clientApprovedAt" | "clientApprovedNegativeTags">;
const CASES: Case[] = [];
for (const rawTags of [[], ["Pending"], ["Signed"], ["Opportunity"], ["Pending", "No Case"], ["Signed", "Lost"], ["Opportunity", "Declined"]]) {
  for (const statusTagMatched of [null, "Pending", "Signed", "No Case"]) {
    for (const [status, statusOverride] of [["pending", null], ["signed", null], ["pending", "pending"], ["signed", "signed"]] as const) {
      for (const approval of [null, [], ["no case"], ["lost", "no case", "declined"]]) {
        for (const needsReview of [false, true]) {
          CASES.push({ rawTags, statusTagMatched, status, statusOverride, needsReview, clientApprovedAt: approval ? new Date() : null, clientApprovedNegativeTags: approval ?? [] });
        }
      }
    }
  }
}

describe("adminStatusView is the portal's clientVisibility", () => {
  it(`agrees over ${CASES.length} combinations`, () => {
    for (const c of CASES) {
      const v = adminStatusView(c);
      const p = clientVisibility({
        effectiveStatus: c.status, hasStatusOverride: c.statusOverride !== null, statusTagMatched: c.statusTagMatched, needsReview: c.needsReview,
        negativeTags: negativeTagsOf(c), clientApprovedAt: c.clientApprovedAt, clientApprovedNegativeTags: c.clientApprovedNegativeTags,
      });
      const expected = p.visible ? "shown" : p.reason === "negative_tag" ? "negative" : p.reason === "opportunity_only" ? "opportunity" : "review";
      expect(v.kind, JSON.stringify(c)).toBe(expected);
      if (v.kind === "shown" && p.visible) expect([v.label, v.approved]).toEqual([p.label, p.approved]);
    }
  });

  it("Opportunity + No Case with no Pending tag reads as No Case, needing review — not Pending", () => {
    expect(adminStatusView({ status: "pending", statusOverride: null, statusTagMatched: "No Case", needsReview: false, rawTags: ["Opportunity", "No Case"], clientApprovedAt: null, clientApprovedNegativeTags: [] })).toEqual({ kind: "negative", tags: "No Case" });
  });

  it("a staff status override no longer un-hides a negative tag; an approval does", () => {
    const base = { status: "signed", statusOverride: "signed", statusTagMatched: "Lost", needsReview: false, rawTags: ["Lost"], clientApprovedAt: null, clientApprovedNegativeTags: [] as string[] };
    expect(adminStatusView(base)).toEqual({ kind: "negative", tags: "Lost" });
    expect(adminStatusView({ ...base, clientApprovedAt: new Date(), clientApprovedNegativeTags: ["lost"] })).toEqual({ kind: "shown", label: "signed", text: "Signed", approved: true });
  });

  it("the drawer's From-tags text", () => {
    const r = (rawTags: string[], statusTagMatched: string | null, statusParsed = "pending") => ({
      status: statusParsed, statusParsed, statusOverride: "signed", statusTagMatched, needsReview: false, rawTags, clientApprovedAt: null, clientApprovedNegativeTags: [] as string[],
    });
    expect(fromTagsStatusText(r(["Opportunity", "Declined"], "Declined"))).toBe("Declined, needs review");
    expect(fromTagsStatusText(r(["Pending"], "Pending"))).toBe("Pending");
    expect(fromTagsStatusText(r(["Opportunity"], null))).toBe("Opportunity, not shown");
    expect(fromTagsStatusText(r(["Signed"], "Signed", "signed"))).toBe("Signed");
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
  statusTagMatched: "Pending",
  rawSourceName: null,
  signedAt: null,
  suggestedStatus: null,
  suggestedStatusSeenAt: null,
  needsReview: false,
  parseFailed: false,
  parseError: null,
  possibleDuplicateOf: null,
  rawTags: ["Pending"],
  clientApprovedAt: null,
  clientApprovedBy: null,
  clientApprovedNegativeTags: [],
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
  it("shows what the client sees, and why not when it does not", () => {
    expect(
      statusCells([
        row({ rawTags: ["Pending", "No Case"] }),
        row({}),
        row({ rawTags: ["Opportunity"], statusTagMatched: null }),
        row({ status: "signed", statusParsed: "signed", statusTagMatched: "Signed", rawTags: ["Signed"] }),
        row({ status: "signed", statusParsed: "signed", statusTagMatched: "Signed", rawTags: ["Signed", "Lost"], clientApprovedAt: new Date(), clientApprovedNegativeTags: ["lost"] }),
        row({ status: "pending", statusOverride: "pending", statusTagMatched: "Lost", rawTags: ["Lost"] }),
        row({ needsReview: true }),
      ]),
    ).toEqual([
      "No Case Hidden from client - needs review",
      "Pending Opportunity",
      "Opportunity Not shown to client",
      "Signed Opportunity",
      "Signed Opportunity Approved for client",
      "Lost Hidden from client - needs review (set by admin)",
      "Pending Under review",
    ]);
  });

  it("never reads a negative-tagged lead as Pending or Signed, whatever else it carries", () => {
    for (const tag of SIX) {
      for (const other of ["Pending", "Signed", "Opportunity"]) {
        expect(statusCells([row({ rawTags: [other, tag], statusTagMatched: other === "Opportunity" ? null : other })])[0]).toBe(`${tag} Hidden from client - needs review`);
      }
    }
  });
});
