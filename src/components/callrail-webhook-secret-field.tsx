"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";

export type CallrailWebhookSecretFieldProps = {
  companyId: string | null;
  configured: boolean;
  updatedAt: string | null; // ISO string — dates cross the server/client prop boundary as strings.
};

function relTime(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

// Shared by both LsaClientAdminCard and PpcClientAdminCard — the secret is
// keyed by CallRail company id (see callrailWebhookSecrets in schema.ts),
// not by ppc/lsa client id, since one CallRail company can be shared by a
// client on each side. Write-only: the actual secret is never sent back to
// the browser, only a configured/updatedAt status.
export function CallrailWebhookSecretField({
  companyId,
  configured,
  updatedAt,
}: CallrailWebhookSecretFieldProps) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [isConfigured, setIsConfigured] = useState(configured);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(updatedAt);
  // Computed client-side from wherever this page is actually being viewed
  // (dev/preview/production) rather than a hardcoded domain, so this is
  // always the real URL to paste into CallRail regardless of environment.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  if (!companyId) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        Link a CallRail company above first — the webhook secret is stored
        per company.
      </div>
    );
  }

  const webhookUrl = origin ? `${origin}/api/webhooks/callrail/call-modified` : "";

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("Webhook URL copied");
    } catch {
      toast.error("Couldn't copy — select and copy it manually");
    }
  }

  async function save() {
    const secret = draft.trim();
    if (!secret) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/callrail/webhook-secret/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        updatedAt?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setIsConfigured(true);
      setLastUpdatedAt(body.updatedAt ?? new Date().toISOString());
      setDraft("");
      toast.success("Webhook secret saved");
    } catch (err) {
      toast.error("Couldn't save secret", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
      <Label htmlFor="webhookUrl">CallRail &ldquo;Call Modified&rdquo; webhook</Label>
      <div className="flex gap-2">
        <Input id="webhookUrl" readOnly value={webhookUrl} className="font-mono text-xs" />
        <Button type="button" variant="outline" size="sm" onClick={copyUrl} disabled={!origin}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste this exact URL as the endpoint for a &ldquo;Call Modified&rdquo;
        webhook on this company in CallRail&apos;s settings. The same URL is
        used for every client — CallRail identifies the company from each
        event&apos;s own payload.
      </p>
      <div className="flex gap-2">
        <Input
          id="webhookSecret"
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            isConfigured
              ? "•••••••••• already set — paste to replace"
              : "Paste the secret from CallRail's webhook settings"
          }
        />
        <Button type="button" size="sm" onClick={save} disabled={saving || !draft.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {isConfigured
          ? `Configured${lastUpdatedAt ? ` · updated ${relTime(lastUpdatedAt)}` : ""}. Used to verify that real-time "signed" events actually came from CallRail.`
          : "Not configured yet — real-time sign-date events from CallRail's webhook will be rejected until this is set."}
      </p>
    </div>
  );
}
