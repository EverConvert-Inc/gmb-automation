import { cache } from "react";
import { redirect } from "next/navigation";
import {
  requirePortalSession,
  type PortalRefusalReason,
  type PortalSession,
} from "@/lib/portal/session";

/**
 * requirePortalSession(), deduplicated per request: the firm layout and the
 * page both ask, and React's cache() makes that one Auth call and one
 * membership query rather than two of each. Never shared across requests.
 */
export const portalSession = cache(() => requirePortalSession());

export const PORTAL_LOGIN = "/portal/login";
export const PORTAL_NO_ACCESS = "/portal/no-access";

/** Where a refused PAGE request goes. null = an outage, not an answer. */
export function refusalDestination(reason: PortalRefusalReason): string | null {
  if (reason === "auth_unavailable") return null;
  return reason === "not_signed_in" ? PORTAL_LOGIN : PORTAL_NO_ACCESS;
}

/** The status a refused API request gets. */
export function refusalStatus(reason: PortalRefusalReason): 401 | 403 | 503 {
  if (reason === "auth_unavailable") return 503;
  return reason === "not_signed_in" ? 401 : 403;
}

/**
 * For portal pages that show firm data: the session, or a redirect. A hung
 * or unreachable Auth call (10s limit) throws, so the calm error page says
 * "try again" instead of sending a signed-in client to the login form.
 */
export async function requirePortalPage(): Promise<PortalSession> {
  const session = await portalSession();
  if (session.ok) return session;
  const to = refusalDestination(session.reason);
  if (!to) throw new Error("The sign-in service is temporarily unavailable.");
  redirect(to);
}
