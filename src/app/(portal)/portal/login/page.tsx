import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PortalLoginForm } from "../../_components/login-form";
import { portalSession } from "../../_lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function PortalLoginPage() {
  // A client who is already signed in goes straight to their leads. Anyone
  // else — signed out, staff, untagged, or Auth unreachable — sees the form.
  const session = await portalSession();
  if (session.ok) redirect("/portal");

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Client portal</h1>
          <p className="text-sm text-muted-foreground">Sign in to see your firm&apos;s leads.</p>
        </div>
        <PortalLoginForm />
      </div>
    </div>
  );
}
