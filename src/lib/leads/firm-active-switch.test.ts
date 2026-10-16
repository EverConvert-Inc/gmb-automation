// The Active switch's real handler (toggleFirmActive — the function the
// switch's onClick calls), run against the REAL PATCH /api/admin/firms/[id]
// route. Faked: the staff session and the database.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  sets: [] as Record<string, unknown>[],
  row: { isActive: true, name: "Smith Law", slug: "smith-law" } as Record<string, unknown>,
  fail: null as null | Error,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser: h.getUser } }),
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (h.fail) throw h.fail;
            h.sets.push(v);
            h.row = { ...h.row, ...v };
            return [h.row];
          },
        }),
      }),
    }),
  },
}));

import { PATCH } from "@/app/api/admin/firms/[id]/route";
import { deactivateConfirmText, toggleFirmActive } from "@/components/leads/firm-active";

const FIRM = "11111111-1111-4111-8111-111111111111";

/** The browser's fetch, routed to the real route handler. */
const fetchToRoute = (url: string, init: RequestInit) => {
  expect(url).toBe(`/api/admin/firms/${FIRM}`);
  return PATCH(new Request(`https://x${url}`, init as RequestInit), { params: Promise.resolve({ id: FIRM }) });
};

beforeEach(() => {
  h.getUser.mockReset();
  h.getUser.mockResolvedValue({ data: { user: { email: "s@everconvert.com", app_metadata: { role: "admin" } } } });
  h.sets = [];
  h.row = { isActive: true, name: "Smith Law", slug: "smith-law" };
  h.fail = null;
});

const run = (current: boolean, confirmFn: (m: string) => boolean = () => true, onOptimistic?: (v: boolean) => void) =>
  toggleFirmActive({ firmId: FIRM, firmName: "Smith Law", current, confirmFn, fetchFn: fetchToRoute, onOptimistic });

describe("the Active switch, end to end", () => {
  it("deactivating: asks, moves at once, saves, and ends on what the server stored", async () => {
    const asked: string[] = [];
    const optimistic: boolean[] = [];
    const r = await run(true, (m) => (asked.push(m), true), (v) => optimistic.push(v));
    expect(asked).toEqual([deactivateConfirmText("Smith Law")]);
    expect(optimistic).toEqual([false]); // the switch moved before the request finished
    expect(r).toEqual({ status: "saved", active: false });
    expect(h.sets).toHaveLength(1);
    expect(h.sets[0].isActive).toBe(false);
  });

  it("sends ONLY isActive — the name and slug are never touched", async () => {
    await run(true);
    expect(Object.keys(h.sets[0]).sort()).toEqual(["isActive", "updatedAt"]);
    expect(h.row).toMatchObject({ name: "Smith Law", slug: "smith-law" });
  });

  it("activating never asks", async () => {
    const confirmFn = vi.fn(() => false);
    h.row.isActive = false;
    const r = await run(false, confirmFn);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(r).toEqual({ status: "saved", active: true });
  });

  it("answering no to the dialog sends nothing and changes nothing", async () => {
    const optimistic: boolean[] = [];
    const r = await run(true, () => false, (v) => optimistic.push(v));
    expect(r).toEqual({ status: "cancelled", active: true });
    expect(optimistic).toEqual([]);
    expect(h.sets).toEqual([]);
  });

  it("it does not flip back when the name/slug form saves afterwards (that form never sends isActive)", async () => {
    await run(true); // now inactive
    const res = await PATCH(
      new Request(`https://x/api/admin/firms/${FIRM}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Smith & Co", slug: "smith-co" }), // exactly what FirmDetailsCard sends
      }),
      { params: Promise.resolve({ id: FIRM }) },
    );
    expect(res.status).toBe(200);
    expect(h.row.isActive).toBe(false);
  });

  it("a server error reverts to the original value and returns the message", async () => {
    h.fail = new Error("db down");
    const optimistic: boolean[] = [];
    const r = await run(true, () => true, (v) => optimistic.push(v));
    expect(optimistic).toEqual([false]);
    expect(r.status).toBe("failed");
    expect(r.active).toBe(true); // reverted
    if (r.status === "failed") expect(r.error).toMatch(/Could not/);
  });

  it("a refused session reverts too, with the server's message", async () => {
    h.getUser.mockResolvedValue({ data: { user: { email: "c@firm.com", app_metadata: { role: "client" } } } });
    const r = await run(true);
    expect(r).toEqual({ status: "failed", active: true, error: "admin only" });
    expect(h.sets).toEqual([]);
  });

  it("a network failure reverts, and says nothing was changed", async () => {
    const r = await toggleFirmActive({
      firmId: FIRM,
      firmName: "Smith Law",
      current: true,
      confirmFn: () => true,
      fetchFn: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(r).toEqual({ status: "failed", active: true, error: "Could not reach the server. Nothing was changed." });
  });
});

describe("the switch component wires that handler, and only that", () => {
  it("calls toggleFirmActive with the real confirm and fetch, guards double clicks, and follows the server after a refresh", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src", "components", "leads", "firm-header.tsx"), "utf8");
    expect(src).toMatch(/onClick=\{onToggle\}/);
    expect(src).toMatch(/const result = await toggleFirmActive\(\{[\s\S]*confirmFn: \(m\) => window\.confirm\(m\),[\s\S]*onOptimistic: setActive,/);
    expect(src).toContain("setActive(result.active);");
    expect(src).toContain("if (busyRef.current) return;");
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(!busyRef\.current\) setActive\(firm\.isActive\);\s*\}, \[firm\.isActive\]\);/);
    expect(src).not.toMatch(/fetch\(`\/api/);
  });
});
