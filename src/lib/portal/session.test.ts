import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

import { __setPortalSqlForTests } from "./client";
import { makeFakeSql, type FakeCall } from "./fake-sql";
import { requirePortalSession } from "./session";

const USER = "33333333-3333-3333-3333-333333333333";
const FIRM = "11111111-1111-1111-1111-111111111111";

let calls: FakeCall[] = [];
function membership(rows: unknown[]) {
  const fake = makeFakeSql(() => rows);
  calls = fake.calls;
  __setPortalSqlForTests(fake.sql);
}
function signedIn(appMetadata: unknown, extra: Record<string, unknown> = {}) {
  getUser.mockResolvedValue({
    data: { user: { id: USER, email: "c@firm.com", app_metadata: appMetadata, ...extra } },
    error: null,
  });
}
const member = (over: Record<string, unknown> = {}) => ({
  firm_id: FIRM,
  auth_user_id: USER,
  member_active: true,
  firm_active: true,
  firm_name: "Smith Law",
  ...over,
});

beforeEach(() => {
  getUser.mockReset();
  membership([member()]);
});
afterEach(() => __setPortalSqlForTests(null));

describe("requirePortalSession", () => {
  it("returns the user, the firm and the email for an active client", async () => {
    signedIn({ role: "client" });
    await expect(requirePortalSession()).resolves.toEqual({
      ok: true,
      userId: USER,
      firmId: FIRM,
      firmName: "Smith Law",
      email: "c@firm.com",
      lastSignInAt: null,
    });
  });

  it("carries Auth's last_sign_in_at when present, and nothing else from the user", async () => {
    signedIn({ role: "client" }, { last_sign_in_at: "2026-10-15T14:03:22.123456Z", phone: "555" });
    const s = await requirePortalSession();
    expect(s).toMatchObject({ ok: true, lastSignInAt: "2026-10-15T14:03:22.123456Z" });
    expect(JSON.stringify(s)).not.toContain("555");
  });

  it("finds the firm by the authenticated user id, bound as a parameter", async () => {
    signedIn({ role: "client" });
    await requirePortalSession();
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([USER]);
    expect(calls[0].text).toContain("where u.auth_user_id = $1::uuid");
  });

  it.each([
    ["staff", { role: "admin" }],
    ["untagged", { provider: "email" }],
    ["capitalised role", { role: "Client" }],
    ["padded role", { role: "client " }],
    ["no app_metadata", undefined],
  ])("refuses %s as not_client, without reading the database", async (_label, meta) => {
    signedIn(meta);
    await expect(requirePortalSession()).resolves.toEqual({ ok: false, reason: "not_client" });
    expect(calls).toHaveLength(0);
  });

  it("ignores a client role set only in user_metadata", async () => {
    signedIn({}, { user_metadata: { role: "client" } });
    await expect(requirePortalSession()).resolves.toEqual({ ok: false, reason: "not_client" });
  });

  it.each([
    ["no membership", [], "no_membership"],
    ["an inactive membership", [member({ member_active: false })], "membership_inactive"],
    ["an inactive firm", [member({ firm_active: false })], "firm_inactive"],
  ])("refuses %s", async (_label, rows, reason) => {
    signedIn({ role: "client" });
    membership(rows);
    await expect(requirePortalSession()).resolves.toEqual({ ok: false, reason });
  });

  it("refuses a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requirePortalSession()).resolves.toEqual({ ok: false, reason: "not_signed_in" });
  });

  it("an Auth call that never answers is auth_unavailable within its limit", async () => {
    getUser.mockReturnValue(new Promise(() => {}));
    await expect(requirePortalSession(20)).resolves.toEqual({ ok: false, reason: "auth_unavailable" });
  });

  it("an Auth call that throws is auth_unavailable", async () => {
    getUser.mockRejectedValue(new Error("down"));
    await expect(requirePortalSession()).resolves.toEqual({ ok: false, reason: "auth_unavailable" });
  });

  it("an unreachable Auth is auth_unavailable, not signed out", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0, __isAuthError: true }),
    });
    await expect(requirePortalSession()).resolves.toEqual({ ok: false, reason: "auth_unavailable" });
  });

  it("throws if the membership row belongs to a different user", async () => {
    signedIn({ role: "client" });
    membership([member({ auth_user_id: "99999999-9999-9999-9999-999999999999" })]);
    await expect(requirePortalSession()).rejects.toThrow(/does not match the session/);
  });

  it("throws if a user somehow has two firms", async () => {
    signedIn({ role: "client" });
    membership([member(), member({ firm_id: "22222222-2222-2222-2222-222222222222" })]);
    await expect(requirePortalSession()).rejects.toThrow(/more than one firm/);
  });

  it("defaults to a 10s Auth limit", async () => {
    const { PORTAL_AUTH_TIMEOUT_MS } = await import("./session");
    expect(PORTAL_AUTH_TIMEOUT_MS).toBe(10_000);
  });
});
