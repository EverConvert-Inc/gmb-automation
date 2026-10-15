import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PortalSignOutButton } from "../../_components/sign-out-button";
import { PORTAL_LOGIN, portalSession } from "../../_lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "No access" };

/**
 * For a signed-in account the portal refuses: untagged, staff, no firm, or a
 * deactivated login or firm. Deliberately the same text for all of them, and
 * no links anywhere — only a way to sign out.
 */
export default async function PortalNoAccessPage() {
  const session = await portalSession();
  if (session.ok) redirect("/portal");
  if (session.reason === "not_signed_in") redirect(PORTAL_LOGIN);
  if (session.reason === "auth_unavailable") {
    throw new Error("The sign-in service is temporarily unavailable.");
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">No access</h1>
        <p className="text-sm text-muted-foreground">
          This account doesn&apos;t have access to the client portal. If you think
          that&apos;s a mistake, contact the person who set up your login.
        </p>
        <PortalSignOutButton />
      </div>
    </div>
  );
}
