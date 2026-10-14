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
import { slugify } from "@/lib/leads/firm-admin";

export function NewFirmForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startRefresh] = useTransition();

  // Shown live so a slug collision is visible before submitting, and so the
  // operator can see what the name will actually become.
  const previewSlug = slugify(slug || name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/firms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...(slug ? { slug } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setName("");
      setSlug("");
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
        <CardTitle>Add a firm</CardTitle>
        <CardDescription>
          A firm is the tenant the lead tracker routes to. It has no effect
          until it has at least one routing tag or CallRail company mapping.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="firm-name">Name</Label>
            <Input
              id="firm-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Smith Law Group"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="firm-slug">Slug (optional)</Label>
            <Input
              id="firm-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={previewSlug || "smith-law-group"}
            />
          </div>
          <Button type="submit" disabled={busy || !name}>
            {busy ? "Adding…" : "Add firm"}
          </Button>
        </form>
        {previewSlug ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Slug will be <code className="font-mono">{previewSlug}</code>
          </p>
        ) : null}
        <FormError>{error}</FormError>
      </CardContent>
    </Card>
  );
}
