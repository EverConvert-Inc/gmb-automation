import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

import {
  ADMIN_ROLE,
  checkAdmin,
  isAdminRole,
  readRole,
  requireAdminRoute,
} from "./admin-auth";

function session(appMetadata: unknown, email = "someone@everconvert.com") {
  getUser.mockResolvedValue({ data: { user: { email, app_metadata: appMetadata } } });
}

beforeEach(() => getUser.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("readRole", () => {
  it.each([
    [{ role: "admin" }, "admin"],
    [{ role: "client" }, "client"],
    [{ role: "admin", provider: "email" }, "admin"],
  ])("reads %s", (meta, expected) => {
    expect(readRole(meta)).toBe(expected);
  });

  it.each([[{}], [null], [undefined], ["admin"], [{ role: 1 }], [{ role: null }]])(
    "returns null for %s rather than guessing",
    (meta) => {
      expect(readRole(meta)).toBeNull();
    },
  );
});

describe("isAdminRole", () => {
  it("accepts only the exact tag", () => {
    expect(isAdminRole(ADMIN_ROLE)).toBe(true);
    for (const role of ["client", "Admin", "ADMIN", "admin ", "superadmin", null]) {
      expect(isAdminRole(role)).toBe(false);
    }
  });
});

describe("checkAdmin — both directions", () => {
  it("PASSES a tagged admin", async () => {
    session({ role: "admin" });
    await expect(checkAdmin()).resolves.toEqual({
      ok: true,
      email: "someone@everconvert.com",
    });
  });

  it("403s an UNTAGGED staff session", async () => {
    session({ provider: "email" });
    await expect(checkAdmin()).resolves.toEqual({
      ok: false,
      status: 403,
      error: "admin only",
    });
  });

  it("403s a CLIENT-role session", async () => {
    session({ role: "client" });
    await expect(checkAdmin()).resolves.toEqual({
      ok: false,
      status: 403,
      error: "admin only",
    });
  });

  it("401s when there is no session at all", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(checkAdmin()).resolves.toMatchObject({ ok: false, status: 401 });
  });

  // A gate that opens when its dependency breaks is not a gate.
  it("401s — never passes — when the session lookup throws", async () => {
    getUser.mockRejectedValue(new Error("supabase down"));
    await expect(checkAdmin()).resolves.toMatchObject({ ok: false, status: 401 });
  });

  // user_metadata is writable by the user via supabase.auth.updateUser().
  it("IGNORES a role in user_metadata — only app_metadata counts", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          email: "x@y.com",
          app_metadata: {},
          user_metadata: { role: "admin" },
        },
      },
    });
    await expect(checkAdmin()).resolves.toMatchObject({ ok: false, status: 403 });
  });
});

describe("requireAdminRoute", () => {
  it("returns null for a tagged admin, so the handler proceeds", async () => {
    session({ role: "admin" });
    expect(await requireAdminRoute()).toBeNull();
  });

  it.each([
    ["untagged", { provider: "email" }, 403],
    ["client role", { role: "client" }, 403],
  ])("returns a %s JSON response with status %s", async (_label, meta, status) => {
    session(meta);
    const res = await requireAdminRoute();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(status);
    await expect(res!.json()).resolves.toEqual({ error: "admin only" });
  });

  it("returns 401 JSON when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await requireAdminRoute();
    expect(res!.status).toBe(401);
    await expect(res!.json()).resolves.toEqual({ error: "not signed in" });
  });
});
