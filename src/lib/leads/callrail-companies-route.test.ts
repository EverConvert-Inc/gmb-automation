// GET /api/admin/callrail/companies — staff-only, loads on demand, cached,
// time-limited, and marks which firm already owns each company.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  list: vi.fn(),
  mappings: [] as { callrailCompanyId: string; firmId: string; firmName: string }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser: h.getUser } }),
}));
vi.mock("@/lib/leads/callrail-client", () => ({ listTrackerCompanies: (o: unknown) => h.list(o) }));
vi.mock("@/lib/db/client", () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    orderBy: async () => h.mappings,
  };
  return { db: { select: () => chain } };
});

const STAFF = { email: "s@everconvert.com", app_metadata: { role: "admin" } };
const FIRM = "11111111-1111-4111-8111-111111111111";

async function loadRoute() {
  vi.resetModules(); // a fresh module = an empty per-instance cache
  return (await import("@/app/api/admin/callrail/companies/route")).GET;
}
const get = (GET: (r: Request) => Promise<Response>, qs = "") => GET(new Request(`https://x/api/admin/callrail/companies${qs}`));

beforeEach(() => {
  h.getUser.mockReset();
  h.getUser.mockResolvedValue({ data: { user: STAFF } });
  h.list.mockReset();
  h.list.mockResolvedValue([
    { id: "COM2", name: "Zeta Law", disabled: false },
    { id: "COM1", name: "Alpha Law", disabled: false },
    { id: "COM3", name: null, disabled: true },
  ]);
  h.mappings = [{ callrailCompanyId: "COM2", firmId: FIRM, firmName: "Zeta" }];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("staff only", () => {
  it.each([
    ["signed out", null, 401],
    ["a client", { email: "c@firm.com", app_metadata: { role: "client" } }, 403],
    ["untagged", { email: "u@x.com", app_metadata: {} }, 403],
  ] as const)("%s → %i, CallRail never called", async (_, user, status) => {
    h.getUser.mockResolvedValue({ data: { user } });
    const GET = await loadRoute();
    expect((await get(GET)).status).toBe(status);
    expect(h.list).not.toHaveBeenCalled();
  });
});

describe("the list", () => {
  it("sorted by name, with each company's owning firm, and not cached by the browser", async () => {
    const GET = await loadRoute();
    const res = await get(GET);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.companies).toEqual([
      { id: "COM1", name: "Alpha Law", disabled: false, mappedTo: null },
      { id: "COM3", name: null, disabled: true, mappedTo: null },
      { id: "COM2", name: "Zeta Law", disabled: false, mappedTo: { firmId: FIRM, firmName: "Zeta" } },
    ]);
    expect(body.cached).toBe(false);
  });

  it("is cached per instance: the second request does not call CallRail; ?refresh=1 does", async () => {
    const GET = await loadRoute();
    await get(GET);
    const second = await (await get(GET)).json();
    expect(second.cached).toBe(true);
    expect(h.list).toHaveBeenCalledTimes(1);
    h.mappings = []; // mappings are read fresh even from the cache
    expect((await (await get(GET)).json()).companies.every((c: { mappedTo: unknown }) => c.mappedTo === null)).toBe(true);
    await get(GET, "?refresh=1");
    expect(h.list).toHaveBeenCalledTimes(2);
  });

  it("gives up after 15s with 504 and a message that keeps the paste box in play", async () => {
    vi.useFakeTimers();
    h.list.mockImplementation(
      (o: { signal: AbortSignal }) =>
        new Promise((_, reject) => o.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const GET = await loadRoute();
    const pending = get(GET);
    await vi.advanceTimersByTimeAsync(15_000);
    const res = await pending;
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/did not answer within 15s.*paste the company id/);
  });

  it("a CallRail failure → 502 with a generic message (CallRail's own text is not passed on)", async () => {
    h.list.mockRejectedValue(new Error("CallRail companies request failed: 401 secret details"));
    const GET = await loadRoute();
    const res = await get(GET);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret details");
  });

  it("a failed load is not cached", async () => {
    h.list.mockRejectedValueOnce(new Error("x"));
    const GET = await loadRoute();
    expect((await get(GET)).status).toBe(502);
    expect((await get(GET)).status).toBe(200);
  });
});
