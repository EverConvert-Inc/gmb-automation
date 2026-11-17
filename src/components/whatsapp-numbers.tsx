"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type WhatsappNumberRow = {
  id: string;
  phoneNumberId: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  label: string | null;
  qualityRating: string | null;
  platformType: string | null;
  codeVerificationStatus: string | null;
  isActive: boolean;
};

// "Refresh from Meta": list WABAs, subscribe the app to each, pull numbers.
export function WhatsappDiscoverButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function discover() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/whatsapp/discover", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        wabas?: number;
        found?: number;
        added?: number;
        subscribed?: number;
        errors?: string[];
      };
      if (!res.ok || typeof body.found !== "number") throw new Error(body.error ?? `HTTP ${res.status}`);
      const summary = `${body.wabas} account${body.wabas === 1 ? "" : "s"}, ${body.found} number${body.found === 1 ? "" : "s"} (${body.added} new), webhooks on for ${body.subscribed}.`;
      setMessage(
        body.errors?.length
          ? { tone: "error", text: `${summary} Problems: ${body.errors.join("; ")}` }
          : { tone: "ok", text: summary },
      );
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={discover} disabled={busy}>
        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Refreshing…" : "Refresh from Meta"}
      </Button>
      {message && (
        <span
          className={
            message.tone === "ok"
              ? "max-w-md text-right text-xs text-emerald-700 dark:text-emerald-400"
              : "max-w-md text-right text-xs text-red-700 dark:text-red-400"
          }
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

function LabelField({ row, onSave, busy }: { row: WhatsappNumberRow; onSave: (label: string) => void; busy: boolean }) {
  const [value, setValue] = useState(row.label ?? "");
  const dirty = value.trim() !== (row.label ?? "");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) onSave(value);
      }}
    >
      <input
        aria-label={`Label for ${row.displayPhoneNumber ?? row.phoneNumberId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Client name"
        maxLength={120}
        className="h-8 w-44 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" size="sm" variant="outline" disabled={!dirty || busy}>
        Save
      </Button>
    </form>
  );
}

type RegisterResult =
  | {
      meta: { httpStatus: number; body: string };
      refreshed: { platformType: string | null; codeVerificationStatus: string | null } | null;
      refreshError: string | null;
    }
  | { error: string };

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

// PIN form for a number Meta reports as NOT_APPLICABLE. The PIN lives only in
// this input's state and the one request body; it is cleared as soon as the
// request is sent and never shown back.
function RegisterForm({
  row,
  onResult,
}: {
  row: WhatsappNumberRow;
  onResult: (r: RegisterResult) => void;
}) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^\d{6}$/.test(pin);

  async function submit() {
    if (!valid || busy) return;
    const body = JSON.stringify({ pin });
    setPin("");
    setBusy(true);
    try {
      const res = await fetch(`/api/whatsapp/numbers/${row.id}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const json = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as RegisterResult;
      onResult(json);
      router.refresh();
    } catch (err) {
      onResult({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`Two-step verification PIN for ${row.displayPhoneNumber ?? row.phoneNumberId}`}
        placeholder="6-digit PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="h-8 w-28 rounded-md border bg-background px-2 text-sm tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        disabled={busy}
      />
      <Button type="submit" size="sm" disabled={!valid || busy}>
        {busy ? "Registering…" : "Register for Cloud API"}
      </Button>
    </form>
  );
}

function RegisterResultView({ result }: { result: RegisterResult }) {
  if ("error" in result) {
    return <p className="text-xs text-red-700 dark:text-red-400">Not sent to Meta: {result.error}</p>;
  }
  const ok = result.meta.httpStatus >= 200 && result.meta.httpStatus < 300;
  return (
    <div className="space-y-1 text-xs">
      <div className={ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
        Meta answered HTTP {result.meta.httpStatus}:
      </div>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono">
        {prettyBody(result.meta.body)}
      </pre>
      <div className="text-muted-foreground">
        {result.refreshed
          ? `After refresh: platform type ${result.refreshed.platformType ?? "unknown"}, verification ${result.refreshed.codeVerificationStatus ?? "unknown"}.`
          : `Refresh afterwards failed: ${result.refreshError}`}
      </div>
    </div>
  );
}

const QUALITY_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
  GREEN: "success",
  YELLOW: "warning",
  RED: "destructive",
};

export function WhatsappNumbersTable({ numbers }: { numbers: WhatsappNumberRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept here, not in the form, so Meta's answer stays on screen after the
  // refresh hides the form (the number is no longer NOT_APPLICABLE).
  const [registerResults, setRegisterResults] = useState<Record<string, RegisterResult>>({});

  async function patch(id: string, body: { label?: string | null; isActive?: boolean }) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/numbers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingId(null);
    }
  }

  if (numbers.length === 0) {
    return <p className="text-sm text-muted-foreground">No numbers yet. Use Refresh from Meta once the settings above are in place.</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <ul className="divide-y">
        {numbers.map((n) => {
          const busy = pendingId === n.id;
          const notOnApi = n.platformType && n.platformType !== "CLOUD_API";
          return (
            <li key={n.id} className="space-y-2 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className={n.isActive ? "" : "text-muted-foreground line-through"}>
                      {n.displayPhoneNumber ?? n.phoneNumberId}
                    </span>
                    {n.verifiedName && <span className="font-normal text-muted-foreground">{n.verifiedName}</span>}
                    {n.qualityRating && (
                      <Badge size="sm" variant={QUALITY_VARIANT[n.qualityRating] ?? "secondary"}>
                        Quality {n.qualityRating.toLowerCase()}
                      </Badge>
                    )}
                    {notOnApi && (
                      <Badge size="sm" variant="warning" title="Messages only reach this inbox once the number is registered on the Cloud API">
                        Not on Cloud API ({n.platformType})
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Number id <span className="font-mono">{n.phoneNumberId}</span>
                    {n.wabaId && (
                      <>
                        {" "}· account <span className="font-mono">{n.wabaId}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
                  <LabelField row={n} busy={busy} onSave={(label) => patch(n.id, { label })} />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={n.isActive}
                      disabled={busy}
                      onChange={(e) => patch(n.id, { isActive: e.target.checked })}
                    />
                    In inbox
                  </label>
                </div>
              </div>
              {n.platformType === "NOT_APPLICABLE" && (
                <RegisterForm
                  row={n}
                  onResult={(r) => setRegisterResults((prev) => ({ ...prev, [n.id]: r }))}
                />
              )}
              {registerResults[n.id] && <RegisterResultView result={registerResults[n.id]} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
