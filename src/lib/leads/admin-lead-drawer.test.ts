// The admin lead editor drawer: its markup (rendered with the portal and the
// one-open store faked) and the one-drawer-at-a-time store itself. Keyboard
// and focus behaviour need a real browser and are not covered here.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatEasternDateTime } from "./admin-dates";
import type { AdminLeadRow } from "./queries-admin";

vi.mock("react-dom", async (orig) => ({
  ...(await orig<typeof import("react-dom")>()),
  createPortal: (node: unknown) => node,
}));
// The portal target; the stubbed createPortal above never touches it.
vi.stubGlobal("document", { body: {} });
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { AdminLeadDrawer } from "@/components/leads/admin-lead-drawer";
import {
  __peekLeadDrawerForTests,
  __resetLeadDrawerForTests,
  closeLeadDrawer,
  openLeadDrawer,
  useLeadDrawerOpen,
} from "@/components/leads/admin-lead-drawer-store";

const base: AdminLeadRow = {
  id: "11111111-1111-4111-8111-111111111111",
  firmId: "f1",
  firmName: "Smith Law",
  source: "text",
  callrailId: "CON0abc:SMT01abc",
  personSuffix: "p1",
  occurredAt: new Date("2026-10-14T15:00:00Z"),
  name: "Jane Doe",
  phone: "+15551234567",
  status: "signed",
  isOpportunity: false,
  nameParsed: "Google Local",
  phoneParsed: "+15551234567",
  statusParsed: "pending",
  statusOverride: "signed",
  isOpportunityParsed: false,
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
  rawTags: [],
  clientApprovedAt: null,
  clientApprovedBy: null,
  clientApprovedNegativeTags: [],
  latestNote: null,
};

function render(lead: AdminLeadRow = base) {
  return renderToStaticMarkup(
    createElement(AdminLeadDrawer, {
      lead,
      busy: false,
      error: null,
      note: "",
      onNoteChange: () => {},
      onPatch: () => {},
      onAddNote: () => {},
      onApprove: () => {},
      onClose: () => {},
      returnFocusTo: { current: null },
    }),
  );
}

describe("the lead drawer", () => {
  const html = render();

  it("is a labelled modal dialog with a Close button", () => {
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="[^"]+"/);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain(">Edit lead</h2>");
  });

  it("is a right-side drawer on wide screens and a centred modal on small ones", () => {
    expect(html).toContain("items-center justify-center");
    expect(html).toContain("md:justify-end");
    expect(html).toContain("md:h-full");
  });

  it("uses the firm page's green family", () => {
    expect(html).toContain("firm-ui");
  });

  it("heads with the date and the source label", () => {
    expect(html).toContain(`>${formatEasternDateTime(base.occurredAt)}</span>`);
    expect(html).toMatch(/<span class="[^"]*">Text<\/span>/);
  });

  it("keeps the status and opportunity choices", () => {
    // The tags alone (no tag matched, an opportunity) read as the portal reads them.
    expect(html).toContain("From tags (Opportunity)");
    expect(html).toContain(">Pending</option>");
    expect(html).toContain(">Signed</option>");
    expect(html).toContain("From tags (no)");
    expect(html).toContain(">Yes</option>");
    expect(html).toContain(">No</option>");
  });

  it("shows each current value and where it comes from", () => {
    expect(html).toContain("Now Signed · set by staff");
    expect(html).toContain("Now No · from tags");
    expect(html).toContain("Now Jane Doe · edited by staff");
    expect(html).toContain("Now +15551234567 · from CallRail");
  });

  it("offers revert only on an edited field, with full-width inputs", () => {
    expect(html).toContain("Revert to Google Local");
    expect(html.match(/Revert to/g)).toHaveLength(1);
    expect(html).toContain('value="Jane Doe"');
    expect(html.match(/>Save</g)).toHaveLength(2);
  });

  it("labels the staff note as visible to the firm", () => {
    expect(html).toContain(">Add a staff note</label>");
    expect(html).toContain("Visible to the firm in the portal</p>");
  });

  it("names the matched tag when tags decide the status, with the portal's label", () => {
    const pending = render({ ...base, statusOverride: null, status: "pending", statusTagMatched: "Pending" });
    expect(pending).toContain("Now Pending · from tag “Pending”");
    const other = render({ ...base, statusOverride: null, status: "pending", statusTagMatched: "Retained" });
    expect(other).toContain("Now Opportunity · from tag “Retained”");
  });

  it("a rejection-style tag reads as that tag, hidden from the client — not Pending", () => {
    const out = render({ ...base, statusOverride: null, status: "pending", statusParsed: "pending", statusTagMatched: "No Case" });
    expect(out).toContain("Now No Case · hidden from client");
    expect(out).toContain("From tags (No Case, hidden from client)");
    expect(out).not.toContain("Now Pending");
  });
});

describe("one drawer at a time", () => {
  beforeEach(() => __resetLeadDrawerForTests());

  // useSyncExternalStore's server snapshot is always closed; the client
  // snapshot is what the store reports.
  function Probe({ id }: { id: string }) {
    return createElement("i", null, String(useLeadDrawerOpen(id)));
  }

  it("is closed on the server", () => {
    openLeadDrawer("a");
    expect(renderToStaticMarkup(createElement(Probe, { id: "a" }))).toBe("<i>false</i>");
  });

  it("opening one closes the other; closing a non-open one changes nothing", () => {
    openLeadDrawer("a");
    expect(__peekLeadDrawerForTests()).toBe("a");
    openLeadDrawer("b");
    expect(__peekLeadDrawerForTests()).toBe("b");
    closeLeadDrawer("a");
    expect(__peekLeadDrawerForTests()).toBe("b");
    closeLeadDrawer("b");
    expect(__peekLeadDrawerForTests()).toBeNull();
  });
});

describe("the drawer's input focus ring", () => {
  // Same green as the firm page's buttons (--fu-focus), not the app's lime ring.
  const html = render();
  const controls = [...html.matchAll(/<(select|textarea|input)\b[^>]*>/g)].map((m) => m[0]);

  it("is on every field: status, opportunity, name, phone, note", () => {
    expect(controls).toHaveLength(5);
    for (const c of controls) {
      expect(c).toContain("focus-visible:ring-[var(--fu-focus)]");
      expect(c).not.toContain("focus-visible:ring-ring");
    }
  });
});
