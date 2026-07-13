"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; recipients: string[] }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; message: string };

// Fires the same send the daily cron uses, but with whatever date range
// the operator currently has selected in the page filter.
export function EmailLsaReportButton({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function send() {
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/lsa/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        sent?: number;
        recipients?: string[];
        reason?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (body.sent === 0 && body.reason) {
        setStatus({ kind: "skipped", reason: body.reason });
        return;
      }
      setStatus({ kind: "sent", recipients: body.recipients ?? [] });
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
        title={`Email the current report (${from} → ${to}) to all configured recipients`}
      >
        <Mail className="mr-2 h-4 w-4" />
        {busy ? "Sending…" : "Email this report"}
      </Button>
      {status.kind === "sent" && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Sent to {status.recipients.length} recipient
          {status.recipients.length === 1 ? "" : "s"}.
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
