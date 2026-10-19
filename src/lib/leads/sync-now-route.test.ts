// The firm page's Sync now, end to end at the route: the URL the button sends
// reaches the staff sync route and runs calls, forms AND texts, as a manual
// run. Faked: the staff check and the sync itself.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sync: vi.fn(), denied: null as Response | null }));

vi.mock("@/lib/leads/admin-auth", () => ({ requireAdminRoute: async () => h.denied }));
vi.mock("@/lib/leads/deps", () => ({ createSyncDeps: () => ({}) }));
vi.mock("@/lib/leads/sync", () => ({ syncLeadsForMonth: h.sync }));

import { POST } from "@/app/api/admin/leads/sync-now/route";
import { firmSyncUrl } from "@/components/leads/firm-sync-step";

const ok = { fetched: 1, written: 1, parseFailed: 0, error: null };

beforeEach(() => {
  h.sync.mockReset();
  h.sync.mockResolvedValue({ calls: ok, forms: ok, texts: ok });
  h.denied = null;
});

const post = (path: string) => POST(new Request(`https://app.example${path}`, { method: "POST" }));

describe("Sync now → /api/admin/leads/sync-now", () => {
  it("the button's request runs texts too, as a manual run for the firm's companies", async () => {
    const res = await post(firmSyncUrl(["COM1", "COM2"]));
    expect(res.status).toBe(200);
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.sync.mock.calls[0][1]).toEqual({
      triggeredBy: "manual",
      dryRun: false,
      companyIds: ["COM1", "COM2"],
      includeTexts: true,
    });
  });

  it("returns the texts result for the summary", async () => {
    const body = await (await post(firmSyncUrl(["COM1"]))).json();
    expect(body.texts).toEqual(ok);
  });

  it("without texts=1 the route still leaves texts out", async () => {
    await post("/api/admin/leads/sync-now?companyIds=COM1");
    expect(h.sync.mock.calls[0][1].includeTexts).toBe(false);
  });

  it("500 only when calls, forms and texts all failed", async () => {
    const bad = { ...ok, error: "boom" };
    h.sync.mockResolvedValue({ calls: bad, forms: bad, texts: ok });
    expect((await post(firmSyncUrl(["COM1"]))).status).toBe(200);
    h.sync.mockResolvedValue({ calls: bad, forms: bad, texts: bad });
    expect((await post(firmSyncUrl(["COM1"]))).status).toBe(500);
  });

  it("staff only", async () => {
    h.denied = new Response("no", { status: 403 });
    expect((await post(firmSyncUrl(["COM1"]))).status).toBe(403);
    expect(h.sync).not.toHaveBeenCalled();
  });
});
