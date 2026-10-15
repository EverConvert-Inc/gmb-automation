"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";

/** Signs out and lands on the PORTAL login, never the internal one. */
export function PortalSignOutButton() {
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
    <Button type="button" variant="outline" size="sm" onClick={signOut} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
