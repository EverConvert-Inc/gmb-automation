"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { CircleAlert } from "lucide-react";
import { PortalSpinner } from "./loader";
import { portalButton, portalInput } from "./ui";

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
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground" htmlFor="portal-email">
          Email
        </label>
        <input
          id="portal-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={portalInput}
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground" htmlFor="portal-password">
          Password
        </label>
        <input
          id="portal-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-describedby={error ? "portal-login-error" : undefined}
          className={portalInput}
        />
      </div>
      {error && (
        <p id="portal-login-error" role="alert" className="portal-error-text flex items-start gap-2 text-sm">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={portalButton("primary", "md", "w-full")}>
        {busy && <PortalSpinner size={18} decorative accent="hsl(var(--primary-foreground))" second="#ffffff" />}
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
