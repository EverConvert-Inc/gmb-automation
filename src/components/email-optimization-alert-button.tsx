"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; recipients: string[]; flaggedCount: number }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; message: string };

// Manually fires the same optimization-score sweep + send the 10:15 UTC
// cron runs — a real send, not a dry run. Useful for confirming the alert
// still works without waiting for a campaign to actually dip below 80%.
export function EmailOptimizationAlertButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function send() {
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/ppc/send-optimization-alert", {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        sent?: number;
        recipients?: string[];
        reason?: string;
        flagged?: unknown[];
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (body.sent === 0 && body.reason) {
        setStatus({ kind: "skipped", reason: body.reason });
        return;
      }
      setStatus({
        kind: "sent",
        recipients: body.recipients ?? [],
        flaggedCount: body.flagged?.length ?? 0,
      });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  }

  const busy = status.kind === "sending";

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        onClick={send}
        disabled={busy}
        title="Manually run the optimization score alert check and send if anything is flagged (real send, not a dry run)"
      >
        <AlertTriangle className="mr-2 h-4 w-4" />
        {busy ? "Sending…" : "Send test alert"}
      </Button>
      {status.kind === "sent" && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Sent to {status.recipients.length} recipient
          {status.recipients.length === 1 ? "" : "s"} ({status.flaggedCount}{" "}
          campaign{status.flaggedCount === 1 ? "" : "s"} flagged).
        </p>
      )}
      {status.kind === "skipped" && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Skipped: {status.reason}.
        </p>
      )}
      {status.kind === "error" && (
        <p className="max-w-xs text-right text-xs text-red-600 dark:text-red-400">
          {status.message}
        </p>
      )}
    </div>
  );
}
