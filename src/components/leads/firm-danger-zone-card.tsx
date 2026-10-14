"use client";

import { useState } from "react";
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

/**
 * Deleting a firm is refused by the API while it still owns leads
 * (leads.firm_id is ON DELETE RESTRICT), so the destructive case this guards
 * against is deleting an EMPTY firm whose tags and company mappings would go
 * with it — which silently changes where future leads route.
 */
export function FirmDangerZoneCard({
  firmId,
  firmName,
  leadCount,
}: {
  firmId: string;
  firmName: string;
  leadCount: number;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function destroy() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/firms/${firmId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push("/admin/firms");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Delete firm</CardTitle>
        <CardDescription>
          {leadCount > 0
            ? `This firm owns ${leadCount} lead${leadCount === 1 ? "" : "s"} and cannot be deleted. Deactivate it instead — that stops new leads routing to it without touching its history.`
            : "Removes the firm and its routing tags and company mappings. Leads that would have routed here go to the admin queue instead."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="firm-delete-confirm">
            Type <span className="font-mono">{firmName}</span> to confirm
          </Label>
          <Input
            id="firm-delete-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={leadCount > 0}
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={destroy}
          disabled={busy || leadCount > 0 || confirm !== firmName}
        >
          {busy ? "Deleting…" : "Delete firm"}
        </Button>
        <FormError>{error}</FormError>
      </CardContent>
    </Card>
  );
}
