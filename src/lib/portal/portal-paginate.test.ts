// The portal's leads list in pages of 15: the pure slicing, plus the
// rendered page 1 of a month with more leads than fit.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { PORTAL_PAGE_SIZE, paginate } from "@/app/(portal)/_lib/paginate";
import { LeadsView } from "@/app/(portal)/_components/leads-view";
import type { PortalLead } from "./db";

const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginate", () => {
  it("the page size is 15", () => {
    expect(PORTAL_PAGE_SIZE).toBe(15);
  });

  it("pages of 15", () => {
    const p = paginate(nums(40), 1);
    expect(p).toMatchObject({ page: 1, pageCount: 3, first: 1, last: 15, total: 40 });
    expect(p.items).toEqual(nums(15));
    expect(paginate(nums(40), 2)).toMatchObject({ first: 16, last: 30 });
  });

  it("a short last page", () => {
    const p = paginate(nums(40), 3);
    expect(p).toMatchObject({ page: 3, first: 31, last: 40 });
    expect(p.items).toHaveLength(10);
  });

  it("clamps a page past either end", () => {
    expect(paginate(nums(40), 9).page).toBe(3);
    expect(paginate(nums(40), 0).page).toBe(1);
    expect(paginate(nums(40), Number.NaN).page).toBe(1);
  });

  it("an empty list is one empty page", () => {
    expect(paginate([], 1)).toEqual({ page: 1, pageCount: 1, first: 0, last: 0, total: 0, items: [] });
  });

  it("exactly one page has no second", () => {
    expect(paginate(nums(15), 2)).toMatchObject({ page: 1, pageCount: 1, last: 15 });
  });
});

const lead = (i: number): PortalLead =>
  ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    date: "2026-10-10",
    name: `Lead ${i}`,
    phone: "+15551234567",
    status: "pending",
    signedDate: null,
    firmNote: null,
    staffNote: null,
  }) as PortalLead;

function render(count: number) {
  return renderToStaticMarkup(
    createElement(LeadsView, { leads: nums(count).map(lead), monthLabel: "October 2026", noteMaxLength: 2000 }),
  );
}

/** Row names in the desktop table only (the phone cards repeat them). */
function tableNames(html: string): string[] {
  const table = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
  return [...table.matchAll(/>(Lead \d+)</g)].map((m) => m[1]);
}

describe("the leads list in pages", () => {
  it("shows the first 15 of 20, with Next enabled and Previous disabled", () => {
    const html = render(20);
    expect(tableNames(html)).toEqual(nums(15).map((i) => `Lead ${i}`));
    expect(html).toContain('aria-label="Leads pages"');
    expect(html).toContain("1–15 of 20");
    expect(html).toContain("Page 1 of 2");
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>.*?Previous/);
    expect(html).not.toMatch(/<button type="button" disabled=""[^>]*>Next/);
  });

  it("no page controls when everything fits", () => {
    const html = render(15);
    expect(tableNames(html)).toHaveLength(15);
    expect(html).not.toContain("Leads pages");
  });
});
