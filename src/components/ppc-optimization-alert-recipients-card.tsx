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
import type { Recipient } from "./ppc-report-recipients-card";

export function PpcOptimizationAlertRecipientsCard({
  initial,
}: {
  initial: Recipient[];
}) {
  const router = useRouter();
  const [recipients, setRecipients] = useState<Recipient[]>(initial);
  const [email, setEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddBusy(true);
    try {
      const res = await fetch("/api/ppc/optimization-alert-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as Recipient;
      setRecipients((prev) =>
        [...prev, created].sort((a, b) => a.email.localeCompare(b.email)),
      );
      setEmail("");
      startRefresh(() => router.refresh());
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAddBusy(false);
    }
  }

  async function remove(id: string) {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/ppc/optimization-alert-recipients/${id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setRecipients((prev) => prev.filter((r) => r.id !== id));
      startRefresh(() => router.refresh());
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Optimization score alert recipients</CardTitle>
        <CardDescription>
          Email addresses that receive an alert when a PPC campaign&rsquo;s
          optimization score drops below 80%. Separate from the daily PPC
          report list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recipients.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            No recipients configured yet. The alert will skip with an error
            until at least one address is added.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {recipients.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span className="truncate">{r.email}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(r.id)}
                  disabled={removingId === r.id}
                  aria-label={`Remove ${r.email}`}
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
            <Label htmlFor="ppc-optimization-alert-recipient-email">
              Add a recipient
            </Label>
            <Input
              id="ppc-optimization-alert-recipient-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <Button type="submit" disabled={addBusy || !email}>
            {addBusy ? "Adding…" : "Add"}
          </Button>
        </form>
        <FormError>{addError}</FormError>
      </CardContent>
    </Card>
  );
}
