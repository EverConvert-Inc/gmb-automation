import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Route- and page-level authorization for the lead tracker's admin surface.
 *
 * Every other internal route in this app relies solely on the middleware's
 * "is there a session" gate, which cannot tell a staff member from a client
 * user. That is fine while client users do not exist; it stops being fine
 * the moment one does, and /admin/leads is a cross-tenant read of every
 * firm's caller names and phone numbers. So this surface checks for itself
 * rather than inheriting a gate that does not yet distinguish anyone.
 *
 * app_metadata, never user_metadata: user_metadata is writable by the user
 * through supabase.auth.updateUser(), so a client could grant themselves
 * whatever it held. app_metadata is writable only by the service role or by
 * direct SQL.
 *
 * NOTE this returns 403 for EVERYONE until staff accounts carry the tag.
 * That is the intended order — tag first, then rely on it — and failing
 * closed is the correct direction for a gate whose whole job is to keep one
 * firm's data away from another.
 */
export const ADMIN_ROLE = "admin";

export type AdminAuthResult =
  | { ok: true; email: string | null }
  | { ok: false; status: 401 | 403; error: string };

/** Reads app_metadata.role defensively — it is whatever is in the JWT. */
export function readRole(appMetadata: unknown): string | null {
  if (appMetadata && typeof appMetadata === "object" && "role" in appMetadata) {
    const role = (appMetadata as { role?: unknown }).role;
    if (typeof role === "string") return role;
  }
  return null;
}

export function isAdminRole(role: string | null): boolean {
  return role === ADMIN_ROLE;
}

export async function checkAdmin(): Promise<AdminAuthResult> {
  let user: { email?: string | null; app_metadata?: unknown } | null = null;
  try {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    user = data.user ?? null;
  } catch {
    // Supabase unconfigured, or the session lookup failed. Treated as
    // signed out rather than as authorised — an auth check that opens up
    // when its dependency breaks is not a check.
    return { ok: false, status: 401, error: "not signed in" };
  }
  if (!user) return { ok: false, status: 401, error: "not signed in" };
  if (!isAdminRole(readRole(user.app_metadata))) {
    return { ok: false, status: 403, error: "admin only" };
  }
  return { ok: true, email: user.email ?? null };
}

/**
 * For API routes: returns a response to send, or null to carry on. Written
 * this way so the call site is two lines and cannot forget to return.
 */
export async function requireAdminRoute(): Promise<NextResponse | null> {
  const result = await checkAdmin();
  if (result.ok) return null;
  return NextResponse.json({ error: result.error }, { status: result.status });
}
