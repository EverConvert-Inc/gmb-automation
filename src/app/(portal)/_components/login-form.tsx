"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";

// One message for every failure — wrong password, unknown email, banned
// account, Auth down — so the form never reveals which emails exist.
const GENERIC_FAILURE = "Sign-in failed. Check your email and password and try again.";

export function PortalLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error("not configured");
      const { error: signInError } = await createBrowserClient(url, key).auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      // Always /portal — any ?next= on this URL is ignored, so this page can
      // never be used to bounce someone elsewhere. A full load, so the server
      // sees the new session cookie.
      window.location.assign("/portal");
    } catch {
      setPassword("");
      setError(GENERIC_FAILURE);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="portal-email">
          Email
        </label>
        <input
          id="portal-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor="portal-password">
          Password
        </label>
        <input
          id="portal-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm portal-error-text">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
