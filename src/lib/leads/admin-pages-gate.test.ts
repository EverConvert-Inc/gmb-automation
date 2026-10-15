import { beforeEach, describe, expect, it, vi } from "vitest";

// Any touch of the database during these tests is a failure: the point is
// that nothing is read before the staff check passes.
vi.mock("@/lib/db/client", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`database touched before the staff check (db.${String(prop)})`);
      },
    },
  ),
}));

const checkAdmin = vi.fn();
vi.mock("@/lib/leads/admin-auth", () => ({ checkAdmin: () => checkAdmin() }));

import * as firmDetail from "@/app/admin/firms/[id]/page";
import * as firmsList from "@/app/admin/firms/page";
import * as leadsList from "@/app/admin/leads/page";
import * as leadQueue from "@/app/admin/leads/queue/page";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";

const PAGES = [
  ["/admin/firms/[id]", firmDetail, { params: Promise.resolve({ id: FIRM_ID }) }],
  ["/admin/firms", firmsList, {}],
  ["/admin/leads", leadsList, { searchParams: Promise.resolve({}) }],
  ["/admin/leads/queue", leadQueue, {}],
] as const;

beforeEach(() => checkAdmin.mockReset());

describe("page titles never carry firm data", () => {
  it.each(PAGES)("%s exports a fixed title and no generateMetadata", (_route, mod) => {
    const m = mod as Record<string, unknown>;
    expect(m.generateMetadata).toBeUndefined();
    expect(typeof (m.metadata as { title?: unknown })?.title).toBe("string");
  });

  it('the firm page title is exactly "Firm"', () => {
    expect((firmDetail as { metadata: { title: string } }).metadata.title).toBe("Firm");
  });
});

describe("nothing is read before the staff check", () => {
  it.each(
    PAGES.flatMap(([route, mod, props]) => [
      [route, "signed out", { ok: false, status: 401, error: "not signed in" }, mod, props],
      [route, "untagged", { ok: false, status: 403, error: "admin only" }, mod, props],
    ]),
  )("%s, %s: renders not-authorized without touching the database", async (_r, _s, result, mod, props) => {
    checkAdmin.mockResolvedValue(result);
    const Page = (mod as { default: (p: unknown) => Promise<unknown> }).default;
    await expect(Page(props)).resolves.toBeTruthy();
  });

  it.each(PAGES)("%s, timed out: fails fast without touching the database", async (_r, mod, props) => {
    checkAdmin.mockResolvedValue({ ok: false, status: 503, error: "auth check timed out" });
    const Page = (mod as { default: (p: unknown) => Promise<unknown> }).default;
    await expect(Page(props)).rejects.toThrow("auth check timed out");
  });
});
