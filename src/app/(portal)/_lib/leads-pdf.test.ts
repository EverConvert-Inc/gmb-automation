import { describe, expect, it } from "vitest";
import type { PortalLead } from "@/lib/portal/db";
import { leadsPdfFilename, renderLeadsPdf } from "./leads-pdf";

const lead = (i: number, over: Partial<PortalLead> = {}): PortalLead => ({
  id: `lead-${i}`,
  date: "2026-11-19",
  name: `Caller ${i}`,
  phone: "+14432071655",
  status: i % 3 === 0 ? "signed" : "pending",
  signedDate: null,
  firmNote: null,
  staffNote: null,
  ...over,
});

describe("renderLeadsPdf", () => {
  const base = { firmName: "Panchenko Law Firm", rangeLabel: "November 2026", reachedLimit: false, statuses: [], generatedAt: new Date("2026-11-20T15:00:00Z") };

  it("renders a real PDF across several pages, with notes from both sides", async () => {
    const leads = Array.from({ length: 60 }, (_, i) =>
      lead(i, i % 4 === 0
        ? { firmNote: { body: "Called back, retained. ".repeat(6), date: "2026-11-19" }, staffNote: { body: "Spoke to intake.", date: "2026-11-20" } }
        : {}),
    );
    const buf = await renderLeadsPdf({ ...base, leads });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  }, 30_000);

  it("renders with no leads, a filter and the limit notice", async () => {
    const buf = await renderLeadsPdf({ ...base, leads: [], statuses: ["signed"], reachedLimit: true });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});

describe("leadsPdfFilename", () => {
  it("slugs the firm name and names the range", () => {
    expect(leadsPdfFilename("Panchenko Law Firm", "2026-11-01", "2026-11-30")).toBe(
      "panchenko-law-firm-leads-2026-11-01-to-2026-11-30.pdf",
    );
    expect(leadsPdfFilename("Smith & Sons, P.A.", "2026-11-01", "2026-11-01")).toBe(
      "smith-sons-p-a-leads-2026-11-01-to-2026-11-01.pdf",
    );
    expect(leadsPdfFilename('"; rm', "2026-11-01", "2026-11-02")).toBe("rm-leads-2026-11-01-to-2026-11-02.pdf");
    expect(leadsPdfFilename("———", "2026-11-01", "2026-11-02")).toBe("leads-leads-2026-11-01-to-2026-11-02.pdf");
  });
});
