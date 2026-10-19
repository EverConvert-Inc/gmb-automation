// "Unknown caller" in the portal: which names are placeholders, that a staff
// override wins, and that the rendered list changes only the name.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { isUnknownName, portalDisplayName } from "./display-name";
import { filterLeads } from "@/app/(portal)/_lib/filter";
import { LeadsView } from "@/app/(portal)/_components/leads-view";
import type { PortalLead } from "./db";

describe("isUnknownName", () => {
  it.each([
    ["No Name"],
    ["no name"],
    ["NO NAME"],
    ["nO nAmE"],
    ["  No Name  "],
    ["No Name."],
    ["(no name)"],
    ["no-name"],
    ["NoName"],
  ])("%j is a placeholder", (name) => {
    expect(isUnknownName(name)).toBe(true);
  });

  it("empty, blank and null are unknown", () => {
    expect(isUnknownName("")).toBe(true);
    expect(isUnknownName("   ")).toBe(true);
    expect(isUnknownName(null)).toBe(true);
    expect(isUnknownName(undefined)).toBe(true);
    expect(isUnknownName("...")).toBe(true);
  });

  it.each([["5551234567"], ["12345"], ["(555) 123-4567"], ["+1 555-123-4567"], ["555.123.4567"]])(
    "%j looks like a number, so it is unknown",
    (name) => expect(isUnknownName(name)).toBe(true),
  );

  it.each([["Google Local Services Ads"], ["google local services ads "], ["Google Local"], ["GOOGLE ADS"], ["Facebook"]])(
    "%j is a lead-source label, so it is unknown",
    (name) => expect(isUnknownName(name)).toBe(true),
  );

  it.each([["Jane Doe"], ["Noel Namey"], ["No Name Smith"], ["Mary O'Neil"], ["José García"], ["Agent 47"], ["Google"]])(
    "%j is a real name",
    (name) => expect(isUnknownName(name)).toBe(false),
  );
});

describe("portalDisplayName", () => {
  it("hides a placeholder unless staff typed it", () => {
    expect(portalDisplayName("No Name", false)).toBeNull();
    expect(portalDisplayName("Google Local Services Ads", false)).toBeNull();
    expect(portalDisplayName(null, false)).toBeNull();
  });

  it("a staff override wins, whatever it says", () => {
    expect(portalDisplayName("Jane Fixed", true)).toBe("Jane Fixed");
    expect(portalDisplayName("5551234567", true)).toBe("5551234567");
  });

  it("leaves a real name untouched", () => {
    expect(portalDisplayName("Jane Doe", false)).toBe("Jane Doe");
  });
});

const lead = (name: string | null): PortalLead => ({
  id: "11111111-1111-4111-8111-111111111111",
  date: "2026-10-10",
  name,
  phone: "+15551234567",
  status: "pending",
  signedDate: null,
  firmNote: null,
  staffNote: null,
});

const render = (name: string | null) =>
  renderToStaticMarkup(createElement(LeadsView, { leads: [lead(name)], monthLabel: "October 2026", noteMaxLength: 2000 }));

const UNKNOWN = '<span class="font-normal text-muted-foreground">Unknown caller</span>';

describe("the portal list with an unknown caller", () => {
  const html = render(null);

  it("shows Unknown caller, muted, in the table and on the phone card", () => {
    expect(html.match(new RegExp(UNKNOWN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(2);
    expect(html).not.toMatch(/No name|No Name/);
  });

  it("still shows the phone", () => {
    expect(html).toContain("(555) 123-4567");
  });

  it("changes nothing else in the markup: swap the name back and it is identical", () => {
    expect(html.split(UNKNOWN).join("Jane Doe")).toBe(render("Jane Doe"));
  });

  it("search still finds it by phone", () => {
    expect(filterLeads([lead(null)], { statuses: new Set(), query: "555 123" })).toHaveLength(1);
    expect(filterLeads([lead(null)], { statuses: new Set(), query: "4567" })).toHaveLength(1);
  });
});
