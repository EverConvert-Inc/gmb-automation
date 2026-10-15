import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
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
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <ShieldAlert aria-hidden className="h-6 w-6 text-muted-foreground" />
        </span>
        <h1 className="mt-4 font-display text-lg font-semibold">No access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This account doesn&apos;t have access to the client portal. If you think
          that&apos;s a mistake, contact the person who set up your login.
        </p>
        <div className="mt-6 flex justify-center">
          <PortalSignOutButton />
        </div>
      </div>
    </div>
  );
}
