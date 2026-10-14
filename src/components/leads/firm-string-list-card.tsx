"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormError, Input, Label } from "@/components/ui/form";

export type FirmListItem = { id: string; value: string };

/**
 * Shared by the routing-tag list and the CallRail company list. They are the
 * same interaction — an add box over a removable list — with different copy
 * and a different endpoint, so the difference stays in the props rather than
 * in a second copy of the fetch/error/refresh plumbing.
 */
export function FirmStringListCard({
  firmId,
  kind,
  title,
  description,
  addLabel,
  placeholder,
  emptyHint,
  bodyKey,
  initial,
}: {
  firmId: string;
  kind: "tags" | "companies";
  title: string;
  description: string;
  addLabel: string;
  placeholder: string;
  emptyHint: string;
  bodyKey: "tagName" | "callrailCompanyId";
  initial: FirmListItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<FirmListItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [bodyKey]: draft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDraft("");
      // Refetched rather than appended from the response: the server
      // normalises what was typed (whitespace collapsed, company id
      // trimmed), so echoing the draft would show something different from
      // what is actually stored and matched on.
      startRefresh(() => router.refresh());
      const listRes = await fetch(`/api/admin/firms/${firmId}/${kind}`);
      if (listRes.ok) setItems(await readList(listRes, kind));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setRemovingId(id);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}/${kind}/${id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            {emptyHint}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="truncate font-mono text-xs sm:text-sm">
                  {item.value}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(item.id)}
                  disabled={removingId === item.id}
                  aria-label={`Remove ${item.value}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={add}
          className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Label htmlFor={`firm-${kind}-add`}>{addLabel}</Label>
            <Input
              id={`firm-${kind}-add`}
              required
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
            />
          </div>
          <Button type="submit" disabled={busy || !draft.trim()}>
            {busy ? "Adding…" : "Add"}
          </Button>
        </form>
        <FormError>{error}</FormError>
      </CardContent>
    </Card>
  );
}

async function readList(
  res: Response,
  kind: "tags" | "companies",
): Promise<FirmListItem[]> {
  const body = (await res.json()) as {
    tags?: { id: string; tagName: string }[];
    companies?: { id: string; callrailCompanyId: string }[];
  };
  return kind === "tags"
    ? (body.tags ?? []).map((t) => ({ id: t.id, value: t.tagName }))
    : (body.companies ?? []).map((c) => ({ id: c.id, value: c.callrailCompanyId }));
}
