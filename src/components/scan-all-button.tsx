"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ScanAllButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/serp-scan/all", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        completed?: number;
        errored?: number;
        totalKeywords?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const parts = [
        `${body.completed ?? 0} of ${body.totalKeywords ?? 0} keywords scanned`,
      ];
      if (body.errored && body.errored > 0) parts.push(`${body.errored} errored`);
      setMessage(parts.join(" · "));
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {message && (
        <span className="text-xs text-green-700">{message}</span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
      <Button variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        {busy ? "Scanning…" : "Scan all now"}
      </Button>
    </div>
  );
}
