"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { updateTakedownStatus, type TakedownStatus } from "@/app/takedowns/actions";
import type { TakedownAlertRow } from "@/lib/queries";
import { formatRelativeDate, formatRelativeTime } from "@/lib/utils";

// Deterministic color assignment per client slug, matching the palette used
// on /rankings — kept local here rather than shared since both are small,
// single-file uses.
const CLIENT_PALETTE = [
  "bg-green-100 text-green-900 border-green-200",
  "bg-amber-100 text-amber-900 border-amber-200",
  "bg-rose-100 text-rose-900 border-rose-200",
  "bg-sky-100 text-sky-900 border-sky-200",
  "bg-teal-100 text-teal-900 border-teal-200",
  "bg-violet-100 text-violet-900 border-violet-200",
  "bg-indigo-100 text-indigo-900 border-indigo-200",
  "bg-orange-100 text-orange-900 border-orange-200",
];

function clientColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  return CLIENT_PALETTE[hash % CLIENT_PALETTE.length];
}

const STATUS_BADGE: Record<string, { label: string; variant: "warning" | "secondary" | "success" }> = {
  confirmed: { label: "Confirmed", variant: "warning" },
  filed: { label: "Filed", variant: "secondary" },
  resolved: { label: "Resolved", variant: "success" },
};

function reinstatementText(row: TakedownAlertRow): string {
  const stars = "★".repeat(row.rating) + "☆".repeat(5 - row.rating);
  return [
    `Location: ${row.locationName} (${row.clientName})`,
    `Reviewer: ${row.reviewerName ?? "Anonymous"}`,
    `Rating: ${stars} (${row.rating}/5)`,
    `Review text: ${row.text ?? "(no text)"}`,
    `Originally posted: ${new Date(row.reviewCreatedAt).toISOString().slice(0, 10)}`,
    `Last confirmed visible on GBP: ${new Date(row.lastSeenAt).toISOString().slice(0, 10)}`,
    `First detected missing: ${new Date(row.detectedMissingAt).toISOString().slice(0, 10)}`,
  ].join("\n");
}

function CopyButton({ row }: { row: TakedownAlertRow }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(reinstatementText(row));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
      title="Copy details for Google's reinstatement request form"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy details"}
    </button>
  );
}

function StatusControl({ row }: { row: TakedownAlertRow }) {
  const [status, setStatus] = useState(row.status);
  const [pending, startTransition] = useTransition();
  const badge = STATUS_BADGE[status] ?? { label: status, variant: "secondary" as const };

  function setNext(next: TakedownStatus) {
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      const result = await updateTakedownStatus(row.id, next);
      if (!result.ok) setStatus(prev);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={badge.variant}>{badge.label}</Badge>
      {status !== "filed" && status !== "resolved" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => setNext("filed")}
          className="text-xs text-brand hover:underline disabled:opacity-50"
        >
          Mark filed
        </button>
      )}
      {status !== "resolved" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => setNext("resolved")}
          className="text-xs text-brand hover:underline disabled:opacity-50"
        >
          Resolve
        </button>
      )}
    </div>
  );
}

export function TakedownsTable({ rows }: { rows: TakedownAlertRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/10 px-6 py-12 text-center">
        <p className="text-sm font-medium">No confirmed takedowns.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Reviews get listed here once they&apos;ve been continuously absent
          from a Google Business Profile sweep for over an hour, to rule out
          a transient API blip before escalating.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Client / Location</th>
            <th className="px-3 py-2 font-medium">Review</th>
            <th className="px-3 py-2 font-medium">Timeline</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
            return (
              <tr key={r.id} className="border-b align-top last:border-0">
                <td className="px-3 py-3">
                  <Link
                    href={`/clients/${r.clientSlug}`}
                    className={`inline-flex max-w-[16ch] items-center truncate rounded-full border px-2 py-0.5 text-xs font-medium ${clientColor(r.clientSlug)} hover:opacity-80`}
                    title={r.clientName}
                  >
                    {r.clientName}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">{r.locationName}</div>
                </td>
                <td className="px-3 py-3 max-w-[32ch]">
                  <div className="text-amber-500">{stars}</div>
                  <div className="font-medium">{r.reviewerName ?? "Anonymous"}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.text ?? <em>(no text)</em>}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  <div>Posted {formatRelativeDate(r.reviewCreatedAt)}</div>
                  <div>Last seen live {formatRelativeDate(r.lastSeenAt)}</div>
                  <div>Confirmed gone {formatRelativeTime(r.confirmedAt)}</div>
                </td>
                <td className="px-3 py-3">
                  <StatusControl row={r} />
                </td>
                <td className="px-3 py-3 text-right">
                  <CopyButton row={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
