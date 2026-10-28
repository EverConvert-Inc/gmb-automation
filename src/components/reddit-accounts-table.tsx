"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type RedditAccountRow = {
  id: string;
  name: string;
  redditAdAccountId: string;
  isShared: boolean;
  currency: string | null;
  isActive: boolean;
  redditClientId: string | null;
  lastSeenAt: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// "Refresh accounts": discovery only, no spend pull.
export function RedditDiscoverButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function discover() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/reddit/discover", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        found?: number;
        added?: number;
        errors?: string[];
      };
      if (!res.ok || typeof body.found !== "number") throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage(
        body.errors?.length
          ? { tone: "error", text: `Found ${body.found}, but: ${body.errors[0]}` }
          : { tone: "ok", text: `Found ${body.found} account${body.found === 1 ? "" : "s"}, ${body.added} new.` },
      );
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message && (
        <span
          className={
            message.tone === "ok"
              ? "text-xs text-emerald-700 dark:text-emerald-400"
              : "max-w-xs text-xs text-red-700 dark:text-red-400"
          }
        >
          {message.text}
        </span>
      )}
      <Button type="button" variant="outline" size="sm" onClick={discover} disabled={busy}>
        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Refreshing…" : "Refresh accounts"}
      </Button>
    </div>
  );
}

// Discovered ad accounts with their client mapping. Each change PATCHes
// immediately and refreshes the server-rendered page.
export function RedditAccountsTable({
  accounts,
  clients,
}: {
  accounts: RedditAccountRow[];
  clients: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: { redditClientId?: string | null; isActive?: boolean }) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/reddit/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingId(null);
    }
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No ad accounts yet. Use Refresh accounts to discover them.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <ul className="divide-y">
        {accounts.map((a) => {
          const busy = pendingId === a.id;
          return (
            <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  <span className={a.isActive ? "" : "text-muted-foreground line-through"}>{a.name}</span>
                  {a.isShared && <Badge variant="secondary">Shared</Badge>}
                  {a.currency !== "USD" && (
                    <Badge variant="warning">{a.currency ?? "Unknown currency"}: excluded from totals</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{a.redditAdAccountId}</span> · last synced {fmtWhen(a.lastSyncAt)}
                </div>
                {a.lastSyncError && (
                  <div className="break-words text-xs text-red-700 dark:text-red-400">{a.lastSyncError}</div>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-3">
                <select
                  aria-label={`Client for ${a.name}`}
                  className="h-8 w-full rounded-md border bg-background px-2 text-xs sm:w-56"
                  value={a.redditClientId ?? ""}
                  disabled={busy}
                  onChange={(e) => patch(a.id, { redditClientId: e.target.value || null })}
                >
                  <option value="">Unmapped</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={a.isActive}
                    disabled={busy}
                    onChange={(e) => patch(a.id, { isActive: e.target.checked })}
                  />
                  Sync
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
