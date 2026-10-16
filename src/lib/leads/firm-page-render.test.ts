// The firm page, rendered with a firm that HAS synced leads: step 3 is Done
// and the strip counts them. Faked: the staff check and the database.
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const FIRM = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({ leadCount: 48, queue: 0 }));

vi.mock("@/lib/leads/admin-auth", () => ({ checkAdmin: async () => ({ ok: true, email: "s@everconvert.com" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), notFound: () => { throw new Error("404"); } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
vi.mock("@/lib/db/client", () => {
  // select(fields).from(table).where(cond) → rows, chosen by the fields asked for.
  const select = (fields: Record<string, unknown>) => ({
    from: () => ({
      where: async () => {
        if ("slug" in fields) {
          return [{ id: "11111111-1111-4111-8111-111111111111", name: "Smith Law", slug: "smith-law", isActive: true, leadCount: h.leadCount }];
        }
        if ("n" in fields) return [{ n: h.queue }];
        return []; // visible-now candidates
      },
    }),
  });
  const findMany = (rows: unknown[]) => ({ findMany: async () => rows });
  return {
    db: {
      select,
      query: {
        leadFirmTags: findMany([]),
        leadFirmCallrailCompanies: findMany([{ id: "m1", callrailCompanyId: "COM0123456789abcdef" }]),
        leadFirmUsers: findMany([{ id: "u1", email: "jane@smithlaw.com", isActive: true }]),
      },
    },
  };
});

import FirmDetailPage from "@/app/admin/firms/[id]/page";

async function render() {
  const el = (await FirmDetailPage({ params: Promise.resolve({ id: FIRM }) })) as ReactElement;
  return renderToStaticMarkup(el);
}
const stepState = (html: string, n: number) =>
  html.slice(html.indexOf(`id="firm-step-${n}"`)).match(/data-step-state="(\w+)"/)?.[1];

describe("firm page with synced leads", () => {
  it("shows Sync and review as Done, and Leads synced as the real count", async () => {
    h.leadCount = 48;
    const html = await render();
    expect(stepState(html, 3)).toBe("done");
    expect(html).toMatch(/data-tile="synced"[\s\S]*?>48</);
    expect(stepState(html, 1)).toBe("done");
    expect(stepState(html, 2)).toBe("done");
  });

  it("with no leads yet, step 3 is Not done", async () => {
    h.leadCount = 0;
    const html = await render();
    expect(stepState(html, 3)).toBe("todo");
  });

  it("the Danger zone knows the firm has leads (delete stays refused)", async () => {
    h.leadCount = 48;
    const html = await render();
    expect(html).toContain("Has 48 leads, so it can&#x27;t be deleted.");
  });
});

describe("Sync now refreshes the page's status", () => {
  it("calls router.refresh() after a successful sync, so the step and strip update without a reload", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src", "components", "leads", "firm-sync-step.tsx"), "utf8");
    expect(src).toMatch(/setResult\(\{ calls: body\.calls, forms: body\.forms \}\);\s*startRefresh\(\(\) => router\.refresh\(\)\);/);
  });
});
