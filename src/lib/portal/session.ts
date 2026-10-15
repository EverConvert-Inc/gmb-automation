// Resolves who is asking and which firm they belong to. Every portal page and
// route calls this itself; the middleware only decides who may REACH the
// portal, never what they may see in it.

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { portalQuery } from "./client";
import { assertRows } from "./guards";
import type { SessionFirmId } from "./types";

export const PORTAL_AUTH_TIMEOUT_MS = 10_000;
const CLIENT_ROLE = "client";

export type PortalSession = {
  ok: true;
  userId: string;
  firmId: SessionFirmId;
  email: string | null;
};

export type PortalRefusalReason =
  | "not_signed_in"
  | "auth_unavailable"
  | "not_client"
  | "no_membership"
  | "membership_inactive"
  | "firm_inactive";

export type PortalRefusal = { ok: false; reason: PortalRefusalReason };

class AuthTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AuthTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const refuse = (reason: PortalRefusalReason): PortalRefusal => ({ ok: false, reason });

export async function requirePortalSession(
  authTimeoutMs: number = PORTAL_AUTH_TIMEOUT_MS,
): Promise<PortalSession | PortalRefusal> {
  type AuthUser = { id: string; email?: string | null; app_metadata?: Record<string, unknown> };
  let user = null as AuthUser | null;
  try {
    const { data, error } = await withTimeout(
      (async () => (await getSupabaseServerClient()).auth.getUser())(),
      authTimeoutMs,
    );
    user = (data.user as AuthUser | null) ?? null;
    // Auth unreachable is not "signed out" — reported separately so the
    // portal can say "try again" rather than "sign in".
    if (!user && error && isAuthRetryableFetchError(error)) return refuse("auth_unavailable");
  } catch {
    return refuse("auth_unavailable");
  }
  if (!user) return refuse("not_signed_in");

  // Exact match, app_metadata only. user_metadata is writable by the user.
  if (user.app_metadata?.role !== CLIENT_ROLE) return refuse("not_client");

  // The one query not scoped by a firm: it is how the firm is FOUND. It is
  // scoped by the authenticated user id instead, and every row returned must
  // carry that same id.
  const userId = user.id;
  const rows = await portalQuery("session: membership", (sql) => sql`
    select
      u.firm_id::text       as firm_id,
      u.auth_user_id::text  as auth_user_id,
      u.is_active           as member_active,
      f.is_active           as firm_active
    from lead_firm_users u
    join lead_firms f on f.id = u.firm_id
    where u.auth_user_id = ${userId}::uuid
  `);
  assertRows(
    "session: membership",
    rows,
    { firm_id: "string", auth_user_id: "string", member_active: "boolean", firm_active: "boolean" },
    { auth_user_id: userId },
  );
  // lead_firm_users.auth_user_id is UNIQUE, so more than one row means the
  // constraint has been bypassed. Refuse loudly rather than pick a firm.
  if (rows.length > 1) throw new Error("A portal user belongs to more than one firm.");
  if (rows.length === 0) return refuse("no_membership");

  const m = rows[0];
  if (!m.member_active) return refuse("membership_inactive");
  if (!m.firm_active) return refuse("firm_inactive");

  return {
    ok: true,
    userId,
    firmId: m.firm_id as SessionFirmId,
    email: user.email ?? null,
  };
}
