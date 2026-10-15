import "server-only";
// ^ Next.js maps this to a module that throws if any browser bundle ever
// includes this file. Not an installed package: it is Next's own built-in
// mapping, so it costs nothing and needs no dependency.

// Creating, deactivating and reactivating client users, and resetting their
// temporary password. The ONLY file in the codebase that reads the
// service-role key — src/lib/portal/isolation.test.ts fails if the key's name
// appears anywhere else under src/.
//
// Database access is passed in rather than imported, so this file stays
// inside the portal's isolation rule (it may not import the shared db
// client). The admin routes supply it.

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/**
 * Hard-coded. Nothing in this file reads a role from a request, a header, a
 * query string or a body — so no request shape can produce an admin account.
 */
const CLIENT_ROLE = "client" as const;

/** ~100 years: Supabase's ban_duration has no "forever". */
const BAN_FOREVER = "876000h";

export type MembershipRow = {
  id: string;
  firmId: string;
  authUserId: string;
  email: string;
  isActive: boolean;
};

/** What the routes supply. */
export type ProvisionDeps = {
  getFirm: (firmId: string) => Promise<{ id: string; isActive: boolean } | null>;
  insertMembership: (row: { firmId: string; authUserId: string; email: string }) => Promise<MembershipRow>;
  getMembership: (firmId: string, membershipId: string) => Promise<MembershipRow | null>;
  setMembershipActive: (membershipId: string, isActive: boolean) => Promise<void>;
  /** The Supabase admin API. Injected so tests never need the real key. */
  auth: AdminAuth;
};

/** The slice of supabase.auth.admin this file uses. */
export type AdminAuth = {
  createUser: (attrs: {
    email: string;
    password: string;
    email_confirm: boolean;
    app_metadata: { role: typeof CLIENT_ROLE };
  }) => Promise<{
    data: { user: { id: string; app_metadata?: Record<string, unknown> } | null };
    error: { code?: string; status?: number; message?: string } | null;
  }>;
  deleteUser: (id: string) => Promise<{ error: { message?: string } | null }>;
  updateUserById: (
    id: string,
    attrs: { ban_duration?: string; password?: string },
  ) => Promise<{ error: { message?: string } | null }>;
};

/**
 * The real admin client, built per call and never cached, so the key lives
 * only as long as a request does.
 */
export function serviceRoleAuth(): AdminAuth {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin access is not configured on the server.");
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client.auth.admin as unknown as AdminAuth;
}

/**
 * 24 random bytes from the OS CSPRNG, base64url: 32 characters, ~192 bits.
 * Never stored, never logged; returned to the caller exactly once.
 */
export function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProvisionResult =
  | { ok: true; user: { membershipId: string; authUserId: string; email: string }; temporaryPassword: string }
  | { ok: false; status: 400 | 404 | 409 | 500 | 502; error: string };

/**
 * Creates a client user for a firm: a Supabase account with role "client"
 * and a confirmed email, then the membership row. If the membership insert
 * fails, the account just created is deleted again. If that cleanup ALSO
 * fails, the result says so — a leftover account has the client role but no
 * membership, which the portal already refuses.
 */
export async function createClientUser(
  deps: ProvisionDeps,
  input: { firmId: string; email: string },
): Promise<ProvisionResult> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return { ok: false, status: 400, error: "Enter a valid email address." };

  const firm = await deps.getFirm(input.firmId);
  if (!firm) return { ok: false, status: 404, error: "Firm not found." };
  if (!firm.isActive) {
    return { ok: false, status: 409, error: "This firm is inactive. Reactivate it before adding users." };
  }

  const temporaryPassword = generateTemporaryPassword();
  let created: Awaited<ReturnType<AdminAuth["createUser"]>>;
  try {
    created = await deps.auth.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { role: CLIENT_ROLE },
    });
  } catch {
    // Caught here, not rethrown: a thrown error from a call that carried the
    // password must never travel up to a logger or an error page.
    return { ok: false, status: 502, error: "Supabase could not be reached. Nothing was changed." };
  }

  if (created.error || !created.data.user) {
    const code = created.error?.code;
    // ANY existing account — staff, a client of another firm, anything —
    // is refused, and nothing is changed. An existing account is never
    // re-tagged; createUser simply fails for a taken email.
    if (code === "email_exists" || code === "user_already_exists" || created.error?.status === 422) {
      return {
        ok: false,
        status: 409,
        error: "That email already belongs to an account. Nothing was changed. Use a different email address.",
      };
    }
    // Never echo Supabase's message: keep the response free of anything the
    // request carried, the temporary password included.
    return { ok: false, status: 502, error: "Supabase could not create the account. Nothing was changed." };
  }

  const authUserId = created.data.user.id;

  // Belt and braces: confirm what Supabase stored is exactly "client".
  if (created.data.user.app_metadata?.role !== CLIENT_ROLE) {
    await deps.auth.deleteUser(authUserId).catch(() => null);
    return { ok: false, status: 500, error: "The account was created with an unexpected role and has been removed." };
  }

  let membership: MembershipRow;
  try {
    membership = await deps.insertMembership({ firmId: firm.id, authUserId, email });
  } catch {
    const cleanup = await deps.auth.deleteUser(authUserId).catch((e: unknown) => ({ error: { message: String(e) } }));
    if (cleanup.error) {
      // Logged with the account id and email only — never the password.
      console.error(
        `[provision] membership insert failed AND cleanup failed: leftover auth user ${authUserId} (${email}) has role "client" but no membership. The portal refuses it. Delete it in Supabase → Authentication → Users.`,
      );
      return {
        ok: false,
        status: 500,
        error: `The user could not be added, and the account created for ${email} could not be removed automatically. It has no firm, so the portal refuses it, but delete it in Supabase → Authentication → Users (id ${authUserId}).`,
      };
    }
    return { ok: false, status: 500, error: "The user could not be added. Nothing was left behind." };
  }

  return {
    ok: true,
    user: { membershipId: membership.id, authUserId, email },
    temporaryPassword,
  };
}

export type MembershipActionResult =
  | { ok: true; temporaryPassword?: string }
  | { ok: false; status: 404 | 502; error: string };

/**
 * Deactivate: the membership goes inactive FIRST — the portal refuses an
 * inactive membership on the very next request — and then the account is
 * banned so it cannot sign in at all. If the ban fails, access is already
 * refused by the membership, and the result says the ban needs retrying.
 */
export async function deactivateClientUser(
  deps: ProvisionDeps,
  firmId: string,
  membershipId: string,
): Promise<MembershipActionResult> {
  const m = await deps.getMembership(firmId, membershipId);
  if (!m) return { ok: false, status: 404, error: "User not found for this firm." };
  await deps.setMembershipActive(m.id, false);
  const banned = await deps.auth
    .updateUserById(m.authUserId, { ban_duration: BAN_FOREVER })
    .catch(() => ({ error: { message: "unreachable" } }));
  if (banned.error) {
    return {
      ok: false,
      status: 502,
      error: "Portal access is removed, but the sign-in ban did not apply. Try deactivating again.",
    };
  }
  return { ok: true };
}

/**
 * Reactivate: lift the ban, then reactivate the membership. Either half
 * alone still leaves the user without portal access, so a partial failure is
 * never a partial grant.
 */
export async function reactivateClientUser(
  deps: ProvisionDeps,
  firmId: string,
  membershipId: string,
): Promise<MembershipActionResult> {
  const m = await deps.getMembership(firmId, membershipId);
  if (!m) return { ok: false, status: 404, error: "User not found for this firm." };
  const unbanned = await deps.auth
    .updateUserById(m.authUserId, { ban_duration: "none" })
    .catch(() => ({ error: { message: "unreachable" } }));
  if (unbanned.error) {
    return { ok: false, status: 502, error: "Could not lift the sign-in ban. Nothing was changed." };
  }
  await deps.setMembershipActive(m.id, true);
  return { ok: true };
}

/**
 * Issues a new temporary password, shown once. The answer to "the admin lost
 * the first one": there is no way to recover a password, only to replace it.
 */
export async function resetClientPassword(
  deps: ProvisionDeps,
  firmId: string,
  membershipId: string,
): Promise<MembershipActionResult> {
  const m = await deps.getMembership(firmId, membershipId);
  if (!m) return { ok: false, status: 404, error: "User not found for this firm." };
  const temporaryPassword = generateTemporaryPassword();
  let updated: Awaited<ReturnType<AdminAuth["updateUserById"]>>;
  try {
    updated = await deps.auth.updateUserById(m.authUserId, { password: temporaryPassword });
  } catch {
    return { ok: false, status: 502, error: "Supabase could not be reached. Nothing was changed." };
  }
  if (updated.error) {
    return { ok: false, status: 502, error: "Supabase could not set a new password. Nothing was changed." };
  }
  return { ok: true, temporaryPassword };
}
