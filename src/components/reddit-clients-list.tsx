"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";

// Reddit's own client list (separate from PPC/LSA clients). Accounts are
// mapped to these from the ad accounts list above.
export function RedditClientsList({
  clients,
}: {
  clients: Array<{ id: string; name: string; accountCount: number }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await send("/api/reddit/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (ok) setName("");
  }

  async function remove(c: { id: string; name: string; accountCount: number }) {
    const detail = c.accountCount
      ? ` Its ${c.accountCount} account${c.accountCount === 1 ? "" : "s"} will become unmapped; spend history is kept.`
      : "";
    if (!window.confirm(`Delete ${c.name}?${detail}`)) return;
    await send(`/api/reddit/clients/${c.id}`, { method: "DELETE" });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New client name"
          aria-label="New client name"
          disabled={busy}
        />
        <Button type="submit" size="sm" className="h-9" disabled={busy || !name.trim()}>
          Add client
        </Button>
      </form>
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Reddit clients yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {clients.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate font-medium">{c.name}</span>
              <span className="flex flex-shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {c.accountCount} account{c.accountCount === 1 ? "" : "s"}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(c)}
                  disabled={busy}
                  aria-label={`Delete ${c.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
