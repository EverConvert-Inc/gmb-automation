import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createClientUser,
  deactivateClientUser,
  generateTemporaryPassword,
  reactivateClientUser,
  resetClientPassword,
  type AdminAuth,
  type MembershipRow,
  type ProvisionDeps,
} from "./provision";

const FIRM = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP = "22222222-2222-4222-8222-222222222222";
const AUTH_ID = "33333333-3333-4333-8333-333333333333";

function membership(over: Partial<MembershipRow> = {}): MembershipRow {
  return { id: MEMBERSHIP, firmId: FIRM, authUserId: AUTH_ID, email: "a@firm.com", isActive: true, ...over };
}

// Every dependency is a vi.fn(), overrides included.
type MockDeps = { [K in Exclude<keyof ProvisionDeps, "auth">]: Mock<ProvisionDeps[K]> } & {
  auth: { [K in keyof AdminAuth]: Mock<AdminAuth[K]> };
};

function makeDeps(over: Partial<ProvisionDeps> = {}, auth: Partial<AdminAuth> = {}): MockDeps {
  const createUser = vi.fn<AdminAuth["createUser"]>(async (attrs) => ({
    data: { user: { id: AUTH_ID, app_metadata: { provider: "email", ...attrs.app_metadata } } },
    error: null,
  }));
  const deleteUser = vi.fn<AdminAuth["deleteUser"]>(async () => ({ error: null }));
  const updateUserById = vi.fn<AdminAuth["updateUserById"]>(async () => ({ error: null }));
  const deps = {
    getFirm: vi.fn(async (id: string) => (id === FIRM ? { id: FIRM, isActive: true } : null)),
    insertMembership: vi.fn(async (row: { firmId: string; authUserId: string; email: string }) =>
      membership({ firmId: row.firmId, authUserId: row.authUserId, email: row.email }),
    ),
    getMembership: vi.fn(async (firmId: string, id: string) =>
      firmId === FIRM && id === MEMBERSHIP ? membership() : null,
    ),
    setMembershipActive: vi.fn(async () => {}),
    auth: { createUser, deleteUser, updateUserById, ...auth },
    ...over,
  } satisfies ProvisionDeps;
  return deps as unknown as MockDeps;
}

/** Every string any console method was handed during a test. */
let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a) ?? String(a))).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

/** The password actually sent to Supabase, read off the mock. */
function sentPassword(deps: ReturnType<typeof makeDeps>): string {
  const call = deps.auth.createUser.mock.calls[0]?.[0] ?? null;
  const reset = deps.auth.updateUserById.mock.calls.find((c) => c[1].password);
  const pw = call?.password ?? reset?.[1].password;
  if (!pw) throw new Error("no password was sent");
  return pw;
}

function expectNowhere(pw: string, ...places: unknown[]) {
  for (const line of logged) expect(line).not.toContain(pw);
  for (const p of places) expect(JSON.stringify(p) ?? "").not.toContain(pw);
}

describe("generateTemporaryPassword", () => {
  it("is long, url-safe and different every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toMatch(/^[A-Za-z0-9_-]{32}$/);
      seen.add(pw);
    }
    expect(seen.size).toBe(200);
  });
});

describe("createClientUser", () => {
  it("creates a confirmed client account, then the membership, and returns the password once", async () => {
    const deps = makeDeps();
    const r = await createClientUser(deps, { firmId: FIRM, email: "  New@Firm.com " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(deps.auth.createUser).toHaveBeenCalledTimes(1);
    const attrs = deps.auth.createUser.mock.calls[0][0];
    expect(attrs.email).toBe("new@firm.com");
    expect(attrs.email_confirm).toBe(true);
    expect(attrs.app_metadata).toEqual({ role: "client" });
    expect(r.temporaryPassword).toBe(attrs.password);
    expect(r.temporaryPassword.length).toBeGreaterThanOrEqual(32);
    expect(deps.insertMembership).toHaveBeenCalledWith({ firmId: FIRM, authUserId: AUTH_ID, email: "new@firm.com" });
    // Once in the result, and nowhere else.
    expect(JSON.stringify(r).split(r.temporaryPassword).length - 1).toBe(1);
    expectNowhere(r.temporaryPassword, deps.insertMembership.mock.calls, r.user);
  });

  it("ignores any role smuggled onto the input object", async () => {
    const deps = makeDeps();
    const input = { firmId: FIRM, email: "x@firm.com", role: "admin", app_metadata: { role: "admin" } };
    await createClientUser(deps, input as unknown as { firmId: string; email: string });
    expect(deps.auth.createUser.mock.calls[0][0].app_metadata).toEqual({ role: "client" });
  });

  it.each(["", "not-an-email", "a@b", "a b@c.com", 42 as unknown as string])(
    "refuses %p with 400 and touches nothing",
    async (email) => {
      const deps = makeDeps();
      const r = await createClientUser(deps, { firmId: FIRM, email });
      expect(r).toMatchObject({ ok: false, status: 400 });
      expect(deps.getFirm).not.toHaveBeenCalled();
      expect(deps.auth.createUser).not.toHaveBeenCalled();
    },
  );

  it("a firm id that doesn't exist → 404, no account created", async () => {
    const deps = makeDeps();
    const r = await createClientUser(deps, { firmId: "99999999-9999-4999-8999-999999999999", email: "x@firm.com" });
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(deps.auth.createUser).not.toHaveBeenCalled();
  });

  it("an inactive firm cannot get new users → 409, no account created", async () => {
    const deps = makeDeps({ getFirm: vi.fn(async () => ({ id: FIRM, isActive: false })) });
    const r = await createClientUser(deps, { firmId: FIRM, email: "x@firm.com" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(deps.auth.createUser).not.toHaveBeenCalled();
  });

  // Supabase refuses a taken email whatever the existing account is — staff
  // (role admin), a client of another firm, or untagged. Nothing is re-tagged:
  // no update call is ever made, and no membership is written.
  it.each([
    ["email_exists", 422],
    ["user_already_exists", 422],
    [undefined, 422],
  ])("duplicate email (%s) → 409, nothing changed", async (code, status) => {
    const deps = makeDeps({}, {
      createUser: vi.fn(async () => ({
        data: { user: null },
        error: { code, status, message: "A user with this email address has already been registered" },
      })),
    });
    const r = await createClientUser(deps, { firmId: FIRM, email: "staff@everconvert.com" });
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toMatch(/already belongs to an account/);
    expect(deps.insertMembership).not.toHaveBeenCalled();
    expect(deps.auth.updateUserById).not.toHaveBeenCalled();
    expect(deps.auth.deleteUser).not.toHaveBeenCalled();
  });

  it("an unexpected Supabase error is not echoed (it could carry what the request sent)", async () => {
    let pw = "";
    const deps = makeDeps({}, {
      createUser: vi.fn(async (attrs) => {
        pw = attrs.password;
        return { data: { user: null }, error: { status: 500, message: `boom ${attrs.password}` } };
      }),
    });
    const r = await createClientUser(deps, { firmId: FIRM, email: "x@firm.com" });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expectNowhere(pw, r);
  });

  it("a THROWN createUser error carrying the password is swallowed, not propagated", async () => {
    let pw = "";
    const deps = makeDeps({}, {
      createUser: vi.fn(async (attrs) => {
        pw = attrs.password;
        throw new Error(`network down while sending ${attrs.password}`);
      }),
    });
    const r = await createClientUser(deps, { firmId: FIRM, email: "x@firm.com" });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expectNowhere(pw, r);
  });

  it("an account that comes back with any role but client is deleted again", async () => {
    const deps = makeDeps({}, {
      createUser: vi.fn(async () => ({
        data: { user: { id: AUTH_ID, app_metadata: { role: "admin" } } },
        error: null,
      })),
    });
    const r = await createClientUser(deps, { firmId: FIRM, email: "x@firm.com" });
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(deps.auth.deleteUser).toHaveBeenCalledWith(AUTH_ID);
    expect(deps.insertMembership).not.toHaveBeenCalled();
  });

  it("cleanup path: membership insert fails → the new account is deleted", async () => {
    const deps = makeDeps({
      insertMembership: vi.fn(async () => {
        throw new Error('duplicate key value violates unique constraint "lead_firm_users_auth_user_id_unique"');
      }),
    });
    const r = await createClientUser(deps, { firmId: FIRM, email: "x@firm.com" });
    expect(r).toMatchObject({ ok: false, status: 500 });
    if (!r.ok) expect(r.error).toMatch(/Nothing was left behind/);
    expect(deps.auth.deleteUser).toHaveBeenCalledWith(AUTH_ID);
    expect(logged).toEqual([]);
    expectNowhere(sentPassword(deps), r);
  });

  it.each([
    ["returns an error", async () => ({ error: { message: "nope" } })],
    ["throws", async () => { throw new Error("socket hang up"); }],
  ])("cleanup path: insert fails AND cleanup %s → says so, logs it, never the password", async (_, impl) => {
    const deps = makeDeps(
      { insertMembership: vi.fn(async () => { throw new Error("insert failed"); }) },
      { deleteUser: vi.fn(impl) as AdminAuth["deleteUser"] },
    );
    const r = await createClientUser(deps, { firmId: FIRM, email: "x@firm.com" });
    expect(r).toMatchObject({ ok: false, status: 500 });
    if (!r.ok) {
      expect(r.error).toMatch(/could not be removed automatically/);
      expect(r.error).toContain(AUTH_ID);
    }
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(logged.join("\n")).toContain(AUTH_ID);
    expectNowhere(sentPassword(deps), r);
  });
});

describe("deactivate / reactivate / reset", () => {
  it("deactivate: membership inactive first, then a ban", async () => {
    const deps = makeDeps();
    const order: string[] = [];
    deps.setMembershipActive.mockImplementation(async () => { order.push("membership"); });
    deps.auth.updateUserById.mockImplementation(async () => { order.push("ban"); return { error: null }; });
    expect(await deactivateClientUser(deps, FIRM, MEMBERSHIP)).toEqual({ ok: true });
    expect(deps.setMembershipActive).toHaveBeenCalledWith(MEMBERSHIP, false);
    expect(deps.auth.updateUserById).toHaveBeenCalledWith(AUTH_ID, { ban_duration: "876000h" });
    expect(order).toEqual(["membership", "ban"]);
  });

  it.each([
    ["errors", async () => ({ error: { message: "x" } })],
    ["throws", async () => { throw new Error("x"); }],
  ])("deactivate: ban %s → 502, but the membership is already inactive", async (_, impl) => {
    const deps = makeDeps({}, { updateUserById: vi.fn(impl) as AdminAuth["updateUserById"] });
    const r = await deactivateClientUser(deps, FIRM, MEMBERSHIP);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(deps.setMembershipActive).toHaveBeenCalledWith(MEMBERSHIP, false);
  });

  it("reactivate: unban, then membership active", async () => {
    const deps = makeDeps();
    expect(await reactivateClientUser(deps, FIRM, MEMBERSHIP)).toEqual({ ok: true });
    expect(deps.auth.updateUserById).toHaveBeenCalledWith(AUTH_ID, { ban_duration: "none" });
    expect(deps.setMembershipActive).toHaveBeenCalledWith(MEMBERSHIP, true);
  });

  it("reactivate: unban fails → membership stays inactive", async () => {
    const deps = makeDeps({}, { updateUserById: vi.fn(async () => ({ error: { message: "x" } })) });
    expect(await reactivateClientUser(deps, FIRM, MEMBERSHIP)).toMatchObject({ ok: false, status: 502 });
    expect(deps.setMembershipActive).not.toHaveBeenCalled();
  });

  it("reset: sets a fresh password and returns it once", async () => {
    const deps = makeDeps();
    const r = await resetClientPassword(deps, FIRM, MEMBERSHIP);
    expect(r.ok).toBe(true);
    const pw = sentPassword(deps);
    expect(r).toEqual({ ok: true, temporaryPassword: pw });
    expect(Object.keys(deps.auth.updateUserById.mock.calls[0][1])).toEqual(["password"]);
    expectNowhere(pw, deps.setMembershipActive.mock.calls);
  });

  it("reset: a thrown error carrying the password is swallowed", async () => {
    let pw = "";
    const deps = makeDeps({}, {
      updateUserById: vi.fn(async (_id, attrs) => {
        pw = attrs.password ?? "";
        throw new Error(`failed with ${attrs.password}`);
      }),
    });
    const r = await resetClientPassword(deps, FIRM, MEMBERSHIP);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expectNowhere(pw, r);
  });

  it.each([
    ["deactivate", deactivateClientUser],
    ["reactivate", reactivateClientUser],
    ["reset", resetClientPassword],
  ] as const)("%s: a membership of ANOTHER firm (or none) → 404, nothing touched", async (_, fn) => {
    const deps = makeDeps();
    const other = "44444444-4444-4444-8444-444444444444";
    expect(await fn(deps, other, MEMBERSHIP)).toMatchObject({ ok: false, status: 404 });
    expect(await fn(deps, FIRM, other)).toMatchObject({ ok: false, status: 404 });
    expect(deps.setMembershipActive).not.toHaveBeenCalled();
    expect(deps.auth.updateUserById).not.toHaveBeenCalled();
  });
});
