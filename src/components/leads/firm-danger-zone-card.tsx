"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FirmButton } from "./firm-button";
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
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {leadCount > 0
          ? `Has ${leadCount} lead${leadCount === 1 ? "" : "s"}, so it can't be deleted. Deactivate it instead.`
          : "Removes the firm, its tags and company mappings."}
      </p>
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
      <FirmButton variant="danger" onClick={destroy} disabled={busy || leadCount > 0 || confirm !== firmName}>
        {busy ? "Deleting…" : "Delete firm"}
      </FirmButton>
      <FormError>{error}</FormError>
    </div>
  );
}
