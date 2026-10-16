import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Scale } from "lucide-react";
import { PortalLoginForm } from "../../_components/login-form";
import { portalSelected } from "../../_components/ui";
import { portalSession } from "../../_lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function PortalLoginPage() {
  // A client who is already signed in goes straight to their leads. Anyone
  // else — signed out, staff, untagged, or Auth unreachable — sees the form.
  const session = await portalSession();
  if (session.ok) redirect("/portal");

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${portalSelected}`}>
            <Scale aria-hidden className="h-6 w-6" />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">Client portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to see your firm&apos;s leads.</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <PortalLoginForm />
        </div>
      </div>
    </div>
  );
}
