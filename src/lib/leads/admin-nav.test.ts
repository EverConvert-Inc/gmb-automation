// The admin area is reachable: an Admin item in the sidebar, /admin opens
// the firms list, and a tab bar links Firms, Leads and Queue.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ redirects: [] as string[] }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  usePathname: () => "/admin/firms",
}));

import AdminIndexPage from "@/app/admin/page";
import { ADMIN_TABS, activeAdminTab } from "@/components/leads/admin-tabs";

describe("sidebar", () => {
  const src = readFileSync(join(process.cwd(), "src", "components", "sidebar.tsx"), "utf8");

  it("has an Admin item for the whole admin area, in place of the old Leads item", () => {
    expect(src).toContain('{ href: "/admin", label: "Admin", icon: ShieldCheck }');
    expect(src).not.toContain('label: "Leads"');
    expect(src).not.toContain('href: "/admin/leads"');
  });

  it("is highlighted on every admin page (the existing prefix rule)", () => {
    expect(src).toContain('pathname === item.href || pathname.startsWith(item.href + "/")');
    for (const p of ["/admin/firms", "/admin/firms/abc", "/admin/leads", "/admin/leads/queue"]) {
      expect(p === "/admin" || p.startsWith("/admin/")).toBe(true);
    }
  });
});

describe("/admin", () => {
  it("opens the firms list", () => {
    expect(() => AdminIndexPage()).toThrow("NEXT_REDIRECT /admin/firms");
    expect(h.redirects).toEqual(["/admin/firms"]);
  });
});

describe("admin tabs", () => {
  it("are Firms, Leads, Queue", () => {
    expect(ADMIN_TABS.map((t) => [t.label, t.href])).toEqual([
      ["Firms", "/admin/firms"],
      ["Leads", "/admin/leads"],
      ["Queue", "/admin/leads/queue"],
    ]);
  });

  it.each([
    ["/admin/firms", "/admin/firms"],
    ["/admin/firms/11111111-1111-4111-8111-111111111111", "/admin/firms"],
    ["/admin/leads", "/admin/leads"],
    ["/admin/leads/queue", "/admin/leads/queue"],
    ["/admin", null],
  ])("%s → %s", (path, tab) => {
    expect(activeAdminTab(path)).toBe(tab);
  });
});
