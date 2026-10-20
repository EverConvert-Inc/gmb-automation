// "Approve for client" and the "Negative tag - needs review" queue reason:
// the route, the update, the queue's condition and reason, the drawer's
// Client section and the queue's bulk approve.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { leads } from "@/lib/db/schema";

const h = vi.hoisted(() => ({
  auth: { ok: true, email: "staff@everconvert.com" } as { ok: true; email: string | null } | { ok: false; status: 401 | 403 | 503; error: string },
  updates: [] as { ids: string[]; by: string | null }[],
}));

vi.mock("@/lib/leads/admin-auth", () => ({ checkAdmin: async () => h.auth }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/leads/client-approval", async (orig) => {
  const real = await orig<typeof import("@/lib/leads/client-approval")>();
  return {
    ...real,
    buildApproveUpdate: (_db: unknown, ids: string[], by: string | null) => {
      h.updates.push({ ids, by });
      return Promise.resolve(ids.slice(0, 1).map((id) => ({ id })));
    },
  };
});
vi.mock("react-dom", async (orig) => ({ ...(await orig<typeof import("react-dom")>()), createPortal: (node: unknown) => node }));
vi.stubGlobal("document", { body: {} });
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement("a", { href, ...rest }, children as never),
}));

import { POST as approve } from "@/app/api/admin/leads/approve/route";
import { ApproveBody, MAX_APPROVE } from "@/lib/leads/client-approval";
import { adminQueueCondition, negativeNeedsReview, type AdminLeadRow } from "@/lib/leads/queries-admin";
import { QUEUE_REASON_LABELS, queueReason } from "@/lib/leads/reconcile";
import { negativeNeedsReviewSql, negativeTagsSql } from "@/lib/portal/visibility";
import { AdminLeadDrawer } from "@/components/leads/admin-lead-drawer";
import { AdminLeadsTable } from "@/components/leads/admin-leads-table";
import { BulkApproveForm } from "@/components/leads/bulk-approve-form";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown) =>
  approve(new Request("https://x/api/admin/leads/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  h.auth = { ok: true, email: "staff@everconvert.com" };
  h.updates = [];
});

describe("POST /api/admin/leads/approve", () => {
  it("approves the given leads, recording the staff email", async () => {
    const res = await post({ leadIds: [ID1, ID2, ID1] });
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ ids: [ID1, ID2], by: "staff@everconvert.com" }]);
    expect(await res.json()).toEqual({ approved: [ID1], requested: 2 });
  });

  it.each([[401], [403], [503]] as const)("staff only: %s passes through, nothing written", async (status) => {
    h.auth = { ok: false, status, error: "no" };
    expect((await post({ leadIds: [ID1] })).status).toBe(status);
    expect(h.updates).toEqual([]);
  });

  it.each([[{}], [{ leadIds: [] }], [{ leadIds: ["not-a-uuid"] }], [{ leadIds: Array.from({ length: MAX_APPROVE + 1 }, () => ID1) }]])(
    "rejects a bad body %#",
    async (body) => {
      expect((await post(body)).status).toBe(400);
      expect(h.updates).toEqual([]);
    },
  );

  it("the body schema allows up to MAX_APPROVE ids", () => {
    expect(ApproveBody.safeParse({ leadIds: Array.from({ length: MAX_APPROVE }, () => ID1) }).success).toBe(true);
  });
});

describe("the approve update", () => {
  it("sets when, who and the lead's CURRENT negative tags (the portal's SQL), for assigned leads only", async () => {
    const { buildApproveUpdate } = await vi.importActual<typeof import("@/lib/leads/client-approval")>("@/lib/leads/client-approval");
    const db = drizzle({} as never, { schema });
    const { sql: text, params } = buildApproveUpdate(db as never, [ID1], "s@e.com").toSQL();
    expect(text).toMatch(/^update "leads" set "client_approved_at" = now\(\), "client_approved_by" = \$1, "client_approved_negative_tags" = /);
    expect(text).toContain(negativeTagsSql('"leads"'));
    expect(text).toContain('"leads"."firm_id" is not null');
    expect(params).toContain("s@e.com");
    expect(params).toContain(ID1);
    // Nothing else changes.
    for (const col of ["status_override", "name_override", "needs_review", "firm_id\" ="]) expect(text.split(" where ")[0]).not.toContain(col);
  });
});

describe("the queue", () => {
  it("its condition includes the portal's negative-tag SQL, over the leads table", () => {
    const db = drizzle({} as never, { schema });
    const { sql: text } = db.select({ id: leads.id }).from(leads).where(adminQueueCondition()).toSQL();
    expect(text).toContain(negativeNeedsReviewSql('"leads"'));
  });

  it("the reason reads \"Negative tag - needs review\", after stale routing and before duplicates", () => {
    const base = { parseFailed: false, firmId: "f1", needsReview: false, possibleDuplicateOf: null };
    expect(QUEUE_REASON_LABELS.negative_tag).toBe("Negative tag - needs review");
    expect(queueReason({ ...base, negativeNeedsReview: true })).toBe("negative_tag");
    expect(queueReason({ ...base, negativeNeedsReview: true, possibleDuplicateOf: "x" })).toBe("negative_tag");
    expect(queueReason({ ...base, negativeNeedsReview: true, needsReview: true })).toBe("stale_routing");
    expect(queueReason({ ...base, negativeNeedsReview: false })).toBeNull();
  });

  it("negativeNeedsReview: a negative tag no approval covers", () => {
    const r = { rawTags: ["Pending", "No Case"], statusTagMatched: "Pending", clientApprovedAt: null, clientApprovedNegativeTags: [] as string[] };
    expect(negativeNeedsReview(r)).toBe(true);
    expect(negativeNeedsReview({ ...r, clientApprovedAt: new Date(), clientApprovedNegativeTags: ["no case"] })).toBe(false);
    expect(negativeNeedsReview({ ...r, rawTags: ["Pending", "No Case", "Lost"], clientApprovedAt: new Date(), clientApprovedNegativeTags: ["no case"] })).toBe(true);
    expect(negativeNeedsReview({ ...r, rawTags: ["Pending"] })).toBe(false);
  });
});

const row = (over: Partial<AdminLeadRow> = {}): AdminLeadRow => ({
  id: ID1,
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

function drawer(lead: AdminLeadRow) {
  return renderToStaticMarkup(
    createElement(AdminLeadDrawer, {
      lead, busy: false, error: null, note: "", onNoteChange: () => {}, onPatch: () => {}, onAddNote: () => {}, onApprove: () => {}, onClose: () => {}, returnFocusTo: { current: null },
    }),
  );
}
const clientSection = (html: string) => html.slice(html.indexOf('aria-label="Client visibility"'), html.indexOf("</section>", html.indexOf('aria-label="Client visibility"')));

describe("the drawer's Client section", () => {
  it("a negative tag: hidden, needs review, Approve for client", () => {
    const s = clientSection(drawer(row({ rawTags: ["Pending", "No Case"] })));
    expect(s).toContain('data-client-visibility="negative_tag"');
    expect(s).toContain("Hidden from the client: negative tag (No Case). Needs review.");
    expect(s).toContain(">Approve for client</button>");
  });

  it("Opportunity only: not shown, Approve for client", () => {
    const s = clientSection(drawer(row({ rawTags: ["Opportunity"], statusTagMatched: null })));
    expect(s).toContain("Not shown to the client: Opportunity only.");
    expect(s).toContain(">Approve for client</button>");
  });

  it("shown, and who approved it when", () => {
    const s = clientSection(drawer(row({ rawTags: ["Opportunity"], statusTagMatched: null, clientApprovedAt: new Date("2026-10-12T15:00:00Z"), clientApprovedBy: "staff@everconvert.com" })));
    expect(s).toContain("Shown to the client as Pending · approved by staff@everconvert.com on");
    expect(s).not.toContain("Approve for client");
  });

  it("a new negative tag after approval: back to review, says why", () => {
    const s = clientSection(drawer(row({ rawTags: ["Pending", "No Case", "Lost"], clientApprovedAt: new Date(), clientApprovedNegativeTags: ["no case"] })));
    expect(s).toContain("negative tag (Lost, No Case)");
    expect(s).toContain("An earlier approval does not cover every tag it carries now.");
    expect(s).toContain(">Approve for client</button>");
  });

  it("a plain Pending lead: shown, nothing to approve", () => {
    const s = clientSection(drawer(row()));
    expect(s).toContain("Shown to the client as Pending");
    expect(s).not.toContain("Approve for client");
  });
});

describe("bulk approve in the queue", () => {
  it("a checkbox per row, one Approve-selected button, starting disabled at 0", () => {
    const html = renderToStaticMarkup(
      createElement(BulkApproveForm, null, createElement(AdminLeadsTable, { rows: [row(), row({ id: ID2 })], emptyMessage: "", selectable: true })),
    );
    const boxes = html.match(/<input type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect(b).toContain('name="leadId"');
    expect(html).toContain(`value="${ID2}"`);
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>Approve selected for client \(0\)<\/button>/);
    expect(html).toContain(">Select all</button>");
  });

  it("the plain table has no checkboxes", () => {
    const html = renderToStaticMarkup(createElement(AdminLeadsTable, { rows: [row()], emptyMessage: "" }));
    expect(html).not.toContain('type="checkbox"');
  });
});
