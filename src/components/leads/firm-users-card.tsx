"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label } from "@/components/ui/form";
import { FirmButton } from "./firm-button";

export type FirmUser = {
  id: string;
  email: string;
  isActive: boolean;
};

type Action = "deactivate" | "reactivate" | "reset_password";

// The one-time password is shown exactly once, and only here:
// - it arrives in a fetch() JSON response (no-store), never in a URL, so it is
//   not in browser history or a server access log;
// - it lives only in this component's state, rendered as plain read-only text
//   with a Copy button — never in an <input>, so the browser has nothing to
//   offer to save or autofill;
// - it is cleared on "Done" and on unmount, and is never written to storage.
// Lost it? Use "Reset password" on the user's row for a new one, shown once.
type Reveal = { email: string; password: string };

export function FirmUsersCard({
  firmId,
  firmActive,
  users: initial,
}: {
  firmId: string;
  firmActive: boolean;
  users: FirmUser[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState<FirmUser[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startRefresh] = useTransition();

  useEffect(() => setUsers(initial), [initial]);
  // Unmount (navigating away) drops the password with the component.
  useEffect(() => () => setReveal(null), []);

  function dismiss() {
    setReveal(null);
    setCopied(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    dismiss();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ email: draft }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: { membershipId: string; email: string };
        temporaryPassword?: string;
      };
      if (!res.ok || !body.user || !body.temporaryPassword) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const created = body.user;
      setUsers((prev) =>
        [...prev, { id: created.membershipId, email: created.email, isActive: true }].sort(
          (a, b) => a.email.localeCompare(b.email),
        ),
      );
      setReveal({ email: created.email, password: body.temporaryPassword });
      setDraft("");
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(user: FirmUser, action: Action) {
    if (
      action === "reset_password" &&
      !confirm(`Set a new temporary password for ${user.email}? Their current password stops working.`)
    ) {
      return;
    }
    if (
      action === "deactivate" &&
      !confirm(`Deactivate ${user.email}? They lose portal access immediately.`)
    ) {
      return;
    }
    setError(null);
    dismiss();
    setActingId(user.id);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        temporaryPassword?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (action === "reset_password" && body.temporaryPassword) {
        setReveal({ email: user.email, password: body.temporaryPassword });
      } else {
        const isActive = action === "reactivate";
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, isActive } : u)));
      }
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
      startRefresh(() => router.refresh());
    } finally {
      setActingId(null);
    }
  }

  async function copy() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
        {reveal && (
          <div
            role="status"
            className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-50"
          >
            <p>
              Temporary password for <strong>{reveal.email}</strong>. It is shown
              this once and is not stored anywhere — copy it now. If it is lost,
              use Reset password for a new one.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="select-all break-all rounded bg-background px-2 py-1 font-mono text-sm">
                {reveal.password}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button type="button" size="sm" onClick={dismiss}>
                Done
              </Button>
            </div>
          </div>
        )}

        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No portal users yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{u.email}</span>
                  {u.isActive ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                </span>
                <span className="flex shrink-0 gap-1">
                  {u.isActive && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={actingId === u.id}
                      onClick={() => act(u, "reset_password")}
                    >
                      Reset password
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={actingId === u.id}
                    onClick={() => act(u, u.isActive ? "deactivate" : "reactivate")}
                  >
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {firmActive ? (
          <form
            onSubmit={add}
            autoComplete="off"
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <Label htmlFor="firm-users-add">Add a client login</Label>
              <Input
                id="firm-users-add"
                type="email"
                name="new-client-email"
                autoComplete="off"
                required
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="name@lawfirm.com"
              />
            </div>
            <FirmButton type="submit" variant="primary" disabled={busy || !draft.trim()}>
              {busy ? "Creating…" : "Create login"}
            </FirmButton>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            This firm is inactive, so it cannot get new users.
          </p>
        )}
        <FormError>{error}</FormError>
    </div>
  );
}
