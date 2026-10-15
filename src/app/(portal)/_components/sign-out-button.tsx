"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { LogOut } from "lucide-react";
import { portalButton } from "./ui";

/**
 * Signs out and lands on the PORTAL login, never the internal one. Styled as
 * a button by default, or as a menu row when given a className.
 */
export function PortalSignOutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      if (url && key) await createBrowserClient(url, key).auth.signOut();
    } finally {
      window.location.assign("/portal/login");
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className={className ?? portalButton("secondary")}
    >
      <LogOut aria-hidden className="h-4 w-4" />
      <span>{busy ? "Signing out…" : "Sign out"}</span>
    </button>
  );
}
