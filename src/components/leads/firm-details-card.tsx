"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormError, Input, Label } from "@/components/ui/form";

export type FirmDetails = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

export function FirmDetailsCard({ firm }: { firm: FirmDetails }) {
  const router = useRouter();
  const [name, setName] = useState(firm.name);
  const [slug, setSlug] = useState(firm.slug);
  const [isActive, setIsActive] = useState(firm.isActive);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startRefresh] = useTransition();

  const dirty =
    name !== firm.name || slug !== firm.slug || isActive !== firm.isActive;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/firms/${firm.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, isActive }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Firm</CardTitle>
        <CardDescription>
          Deactivating a firm stops the sync routing new leads to it. Leads it
          already holds are untouched.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="firm-name">Name</Label>
              <Input
                id="firm-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="firm-slug">Slug</Label>
              <Input
                id="firm-slug"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Active
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {saved && !dirty ? (
              <span className="text-xs text-muted-foreground">Saved</span>
            ) : null}
          </div>
          <FormError>{error}</FormError>
        </form>
      </CardContent>
    </Card>
  );
}
