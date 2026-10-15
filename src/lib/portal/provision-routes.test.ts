// Route-level tests for the client-user admin API. The REAL checkAdmin()
// runs; only its Supabase session lookup, the shared db and the Supabase
// admin client are faked. Lives here rather than beside the routes so the
// app/ tree holds only route files.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

const admin = {
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  updateUserById: vi.fn(),
};
const createClient = vi.fn(() => ({ auth: { admin } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...a: unknown[]) => createClient(...(a as [])) }));

const FIRM = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP = "22222222-2222-4222-8222-222222222222";
const AUTH_ID = "33333333-3333-4333-8333-333333333333";

const firmFindFirst = vi.fn();
const userFindFirst = vi.fn();
const inserted: unknown[] = [];
const updated: unknown[] = [];
vi.mock("@/lib/db/client", () => ({
  db: {
    query: {
      leadFirms: { findFirst: (...a: unknown[]) => firmFindFirst(...a) },
      leadFirmUsers: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    },
    insert: () => ({
      values: (v: { firmId: string; authUserId: string; email: string }) => ({
        returning: async () => {
          inserted.push(v);
          return [{ id: MEMBERSHIP, ...v, isActive: true }];
        },
      }),
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: async () => {
          updated.push(v);
        },
      }),
    }),
  },
}));

import { POST } from "@/app/api/admin/firms/[id]/users/route";
import { PATCH } from "@/app/api/admin/firms/[id]/users/[userId]/route";

const KEY_NAME = ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");

function session(user: unknown) {
  getUser.mockResolvedValue({ data: { user } });
}
const STAFF = { email: "staff@everconvert.com", app_metadata: { role: "admin" } };

let logged: string[] = [];
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv(KEY_NAME, "test-service-role-key");
  for (const f of [getUser, admin.createUser, admin.deleteUser, admin.updateUserById, firmFindFirst, userFindFirst, createClient]) {
    f.mockClear();
  }
  inserted.length = 0;
  updated.length = 0;
  firmFindFirst.mockImplementation(async () => ({ id: FIRM, isActive: true }));
  userFindFirst.mockImplementation(async () => ({
    id: MEMBERSHIP, firmId: FIRM, authUserId: AUTH_ID, email: "a@firm.com", isActive: true,
  }));
  admin.createUser.mockImplementation(async (attrs: { app_metadata: Record<string, unknown> }) => ({
    data: { user: { id: AUTH_ID, app_metadata: { provider: "email", ...attrs.app_metadata } } },
    error: null,
  }));
  admin.deleteUser.mockResolvedValue({ error: null });
  admin.updateUserById.mockResolvedValue({ error: null });
  session(STAFF);
  logged = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function post(body: unknown, { url = `http://x/api/admin/firms/${FIRM}/users`, headers = {}, firmId = FIRM, raw = false } = {}) {
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: firmId }) });
}

function patch(body: unknown, { firmId = FIRM, userId = MEMBERSHIP } = {}) {
  const req = new Request(`http://x/api/admin/firms/${firmId}/users/${userId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: firmId, userId }) });
}

/** Every createUser call ever made asked for exactly role "client". */
function expectOnlyClientRole() {
  for (const [attrs] of admin.createUser.mock.calls) {
    expect(attrs.app_metadata).toEqual({ role: "client" });
    // Exactly these four keys: no user_metadata, no role anywhere else.
    expect(Object.keys(attrs).sort()).toEqual(["app_metadata", "email", "email_confirm", "password"]);
  }
}

describe("staff-only on every route", () => {
  const sessions: [string, () => void, number][] = [
    ["unauthenticated", () => session(null), 401],
    ["session lookup fails", () => getUser.mockRejectedValue(new Error("no cookies")), 401],
    ["untagged", () => session({ email: "u@x.com", app_metadata: {} }), 403],
    ["client", () => session({ email: "c@firm.com", app_metadata: { role: "client" } }), 403],
    ["role in user_metadata only", () => session({ email: "u@x.com", app_metadata: {}, user_metadata: { role: "admin" } }), 403],
    ["Admin (wrong case)", () => session({ email: "u@x.com", app_metadata: { role: "Admin" } }), 403],
  ];

  const calls: [string, () => Promise<Response>][] = [
    ["POST create", () => post({ email: "new@firm.com" })],
    ["PATCH deactivate", () => patch({ action: "deactivate" })],
    ["PATCH reactivate", () => patch({ action: "reactivate" })],
    ["PATCH reset_password", () => patch({ action: "reset_password" })],
  ];

  for (const [who, setup, status] of sessions) {
    it.each(calls)(`${who}: %s → ${status}, nothing touched`, async (_, call) => {
      setup();
      const res = await call();
      expect(res.status).toBe(status);
      expect(createClient).not.toHaveBeenCalled();
      expect(admin.createUser).not.toHaveBeenCalled();
      expect(admin.updateUserById).not.toHaveBeenCalled();
      expect(firmFindFirst).not.toHaveBeenCalled();
      expect(userFindFirst).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
      expect(updated).toEqual([]);
    });
  }

  it("a hung session lookup fails closed with 503 (the 10s bound)", async () => {
    vi.useFakeTimers();
    try {
      getUser.mockReturnValue(new Promise(() => {}));
      const pending = post({ email: "new@firm.com" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).status).toBe(503);
      expect(admin.createUser).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST create", () => {
  it("staff creates a client user: 201, password once, no-store, membership row without the password", async () => {
    const res = await post({ email: "New@Firm.com" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const text = await res.text();
    const body = JSON.parse(text);
    const pw = admin.createUser.mock.calls[0][0].password;
    expect(body.temporaryPassword).toBe(pw);
    expect(text.split(pw).length - 1).toBe(1);
    expect(body.user).toEqual({ membershipId: MEMBERSHIP, authUserId: AUTH_ID, email: "new@firm.com" });
    expect(admin.createUser.mock.calls[0][0].email_confirm).toBe(true);
    expectOnlyClientRole();
    expect(inserted).toEqual([{ firmId: FIRM, authUserId: AUTH_ID, email: "new@firm.com" }]);
    expect(JSON.stringify(inserted)).not.toContain(pw);
    for (const line of logged) expect(line).not.toContain(pw);
  });

  // However the request is shaped, the role can never be admin.
  const fuzz: [string, Parameters<typeof post>][] = [
    ["role in the body", [{ email: "x@firm.com", role: "admin" }]],
    ["app_metadata in the body", [{ email: "x@firm.com", app_metadata: { role: "admin" } }]],
    ["user_metadata in the body", [{ email: "x@firm.com", user_metadata: { role: "admin" } }]],
    ["nested JSON", [{ email: "x@firm.com", user: { app_metadata: { role: "admin" } } }]],
    ["email as an object", [{ email: { address: "x@firm.com", role: "admin" } }]],
    ["array body", [[{ email: "x@firm.com", role: "admin" }]]],
    ["__proto__ key", ['{"email":"x@firm.com","__proto__":{"role":"admin"}}', { raw: true }]],
    ["constructor key", ['{"email":"x@firm.com","constructor":{"prototype":{"role":"admin"}}}', { raw: true }]],
    ["duplicate keys", ['{"email":"x@firm.com","role":"client","role":"admin"}', { raw: true }]],
    ["role in the query string", [{ email: "x@firm.com" }, { url: `http://x/api/admin/firms/${FIRM}/users?role=admin&app_metadata[role]=admin` }]],
    ["role in headers", [{ email: "x@firm.com" }, { headers: { "x-role": "admin", role: "admin", "x-supabase-role": "service_role", authorization: "Bearer admin" } }]],
    ["email containing role text", [{ email: "role=admin@firm.com" }]],
    ["malformed JSON", ['{"email":"x@firm.com",', { raw: true }]],
  ];

  it.each(fuzz)("%s → never an admin account", async (_, args) => {
    const res = await post(...args);
    expect([201, 400]).toContain(res.status);
    expectOnlyClientRole();
    if (res.status === 201) {
      const body = await res.json();
      expect(JSON.stringify(body.user)).not.toMatch(/"role"/);
    }
  });

  it("body keys other than email are refused outright, before Supabase is called", async () => {
    for (const body of [{ email: "x@firm.com", role: "admin" }, { email: "x@firm.com", firmId: "other" }, {}]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it("duplicate email → 409 with a clear message, nothing changed", async () => {
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "email_exists", status: 422, message: "already registered" },
    });
    const res = await post({ email: "staff@everconvert.com" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already belongs to an account/);
    expect(inserted).toEqual([]);
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it("a firm id that doesn't exist → 404, no account", async () => {
    firmFindFirst.mockResolvedValue(undefined);
    const res = await post({ email: "x@firm.com" }, { firmId: "99999999-9999-4999-8999-999999999999" });
    expect(res.status).toBe(404);
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it("a malformed firm id → 404 without a query", async () => {
    const res = await post({ email: "x@firm.com" }, { firmId: "not-a-uuid" });
    expect(res.status).toBe(404);
    expect(firmFindFirst).not.toHaveBeenCalled();
  });

  it("an inactive firm → 409, no account", async () => {
    firmFindFirst.mockResolvedValue({ id: FIRM, isActive: false });
    const res = await post({ email: "x@firm.com" });
    expect(res.status).toBe(409);
    expect(admin.createUser).not.toHaveBeenCalled();
  });
});

describe("PATCH deactivate / reactivate / reset", () => {
  it("deactivate: membership inactive and the account banned", async () => {
    const res = await patch({ action: "deactivate" });
    expect(res.status).toBe(200);
    expect(updated).toEqual([expect.objectContaining({ isActive: false })]);
    expect(admin.updateUserById).toHaveBeenCalledWith(AUTH_ID, { ban_duration: "876000h" });
  });

  it("reactivate: unbanned and membership active", async () => {
    const res = await patch({ action: "reactivate" });
    expect(res.status).toBe(200);
    expect(admin.updateUserById).toHaveBeenCalledWith(AUTH_ID, { ban_duration: "none" });
    expect(updated).toEqual([expect.objectContaining({ isActive: true })]);
  });

  it("reset_password: new password once, no-store, never logged", async () => {
    const res = await patch({ action: "reset_password" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const pw = admin.updateUserById.mock.calls[0][1].password;
    expect((await res.json()).temporaryPassword).toBe(pw);
    for (const line of logged) expect(line).not.toContain(pw);
  });

  it("a user of another firm / unknown id → 404, nothing touched", async () => {
    userFindFirst.mockResolvedValue(undefined);
    const res = await patch({ action: "deactivate" });
    expect(res.status).toBe(404);
    expect(updated).toEqual([]);
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: "promote" }],
    [{ action: "deactivate", role: "admin" }],
    [{ action: "reactivate", app_metadata: { role: "admin" } }],
    [{}],
  ])("refuses %j with 400", async (body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(admin.updateUserById).not.toHaveBeenCalled();
    expect(updated).toEqual([]);
  });
});
