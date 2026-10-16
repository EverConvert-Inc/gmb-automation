// The TEMPORARY diagnostic route: staff-only, always rolls back, and its
// response carries no credentials. Delete with the route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

const h = vi.hoisted(() => ({
  afterFns: [] as (() => void)[],
  afterThrows: false,
  postgresCalls: [] as { url: string; opts: Record<string, unknown> }[],
  queries: [] as string[],
  begin: null as null | ((fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>),
  ended: 0,
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => void) => {
    if (h.afterThrows) throw new Error("`after()` will not work correctly, because `waitUntil` is not available");
    h.afterFns.push(fn);
  },
}));

vi.mock("postgres", () => ({
  default: (url: string, opts: Record<string, unknown>) => {
    h.postgresCalls.push({ url, opts });
    const tx = (strings: TemplateStringsArray) => {
      const text = strings.join("$");
      h.queries.push(text);
      return Object.assign(Promise.resolve({ count: 1 }), { text });
    };
    return {
      begin: (fn: (tx: unknown) => Promise<unknown>) => (h.begin ? h.begin(fn) : fn(tx)),
      end: async () => {
        h.ended += 1;
      },
    };
  },
}));

import { POST } from "@/app/api/admin/portal-events/diagnose/route";

const SECRET_URL = "postgres://postgres.abcd:SuperSecretPw@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { email: "staff@everconvert.com", app_metadata: { role: "admin" } } } });
  Object.assign(h, { afterFns: [], afterThrows: false, postgresCalls: [], queries: [], begin: null, ended: 0 });
  vi.stubEnv("DATABASE_URL", SECRET_URL);
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
});
afterEach(() => vi.unstubAllEnvs());

describe("staff only", () => {
  it.each([
    ["signed out", null, 401],
    ["untagged", { email: "u@x.com", app_metadata: {} }, 403],
    ["a client", { email: "c@firm.com", app_metadata: { role: "client" } }, 403],
  ] as const)("%s → %i, nothing run", async (_, user, status) => {
    getUser.mockResolvedValue({ data: { user } });
    const res = await POST();
    expect(res.status).toBe(status);
    expect(h.postgresCalls).toHaveLength(0);
    expect(h.afterFns).toHaveLength(0);
  });
});

describe("the report", () => {
  it("success path: the test row is rolled back, never committed", async () => {
    const body = await (await POST()).json();
    expect(body.testWrite).toEqual({ ok: true, rowsInserted: 1, rolledBack: true });
    expect(h.queries.some((q) => q.includes("insert into portal_events"))).toBe(true);
    expect(h.ended).toBe(1);
  });

  it("returns the exact Postgres error: name, code, message, constraint", async () => {
    h.begin = async () => {
      throw Object.assign(new Error('new row for relation "portal_events" violates check constraint "portal_events_metadata_check"'), {
        name: "PostgresError",
        code: "23514",
        constraint_name: "portal_events_metadata_check",
      });
    };
    const body = await (await POST()).json();
    expect(body.testWrite).toEqual({
      ok: false,
      name: "PostgresError",
      code: "23514",
      message: 'new row for relation "portal_events" violates check constraint "portal_events_metadata_check"',
      constraint: "portal_events_metadata_check",
    });
  });

  it("host and port only — never the user, password or database name", async () => {
    const res = await POST();
    const text = await res.text();
    expect(JSON.parse(text).database).toEqual({ set: true, host: "aws-0-us-east-1.pooler.supabase.com", port: "6543" });
    expect(text).not.toContain("SuperSecretPw");
    expect(text).not.toContain("postgres.abcd");
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("reports the commit, the after() probe token and the writer's pending count", async () => {
    const body = await (await POST()).json();
    expect(body.deployment.commitSha).toBe("abc123");
    expect(body.after.scheduled).toEqual({ ok: true });
    expect(body.after.probeToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.afterFns).toHaveLength(1);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    h.afterFns[0]();
    expect(log).toHaveBeenCalledWith(`[portal events diagnose] after() ran ${body.after.probeToken}`);
    expect(body.writer.pendingWritesOnThisInstance).toBe(0);
  });

  it("an after() that throws is reported, not fatal", async () => {
    h.afterThrows = true;
    const body = await (await POST()).json();
    expect(body.after.scheduled.ok).toBe(false);
    expect(body.after.scheduled.error).toMatch(/waitUntil/);
  });

  it("uses the writer's connection options under its own name, with placeholder ids only", async () => {
    await POST();
    expect(h.postgresCalls[0].opts).toMatchObject({ max: 1, prepare: false, fetch_types: false });
    expect((h.postgresCalls[0].opts.connection as { application_name: string }).application_name).toBe(
      "gmb-portal-events-diagnose",
    );
  });

  it("never touches a leads table", async () => {
    await POST();
    for (const q of h.queries) expect(q).not.toMatch(/\bleads\b|lead_notes|lead_firms|lead_firm_users/);
  });
});
