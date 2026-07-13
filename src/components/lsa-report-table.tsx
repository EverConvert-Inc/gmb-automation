"use client";

import { useMemo, useState } from "react";
import type { LsaClientRow } from "@/lib/queries-lsa";

type SortKey =
  | "client"
  | "phoneCallCount"
  | "messageCount"
  | "cost"
  | "signedCases";

type SortDir = "asc" | "desc";

const NUMBER_FMT = new Intl.NumberFormat();
function fmtNumber(n: number): string {
  return NUMBER_FMT.format(n);
}
function fmtMicros(microsBig: bigint): string {
  const dollars = Number(microsBig / 10_000n) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}

function compareNumbers(a: number, b: number, dir: SortDir): number {
  return dir === "asc" ? a - b : b - a;
}

function compareStrings(a: string, b: string, dir: SortDir): number {
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

function SortHeader({
  label,
  align,
  field,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  align?: "right" | "left";
  field: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (next: SortKey) => void;
}) {
  const active = sortKey === field;
  const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-0.5 hover:text-foreground"
      >
        {label}
        <span aria-hidden>{arrow}</span>
      </button>
    </th>
  );
}

// One row per client, no expand/collapse — unlike PpcReportTable, LSA has
// no per-campaign breakdown to drill into (lsa_leads_daily is already a
// per-client-per-day rollup, not per-campaign).
export function LsaReportTable({ rows }: { rows: LsaClientRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("signedCases");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function onSort(field: SortKey) {
    if (field === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(field);
      setSortDir(field === "client" ? "asc" : "desc");
    }
  }

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "client":
          return compareStrings(a.lsaClientName, b.lsaClientName, sortDir);
        case "phoneCallCount":
          return compareNumbers(a.phoneCallCount, b.phoneCallCount, sortDir);
        case "messageCount":
          return compareNumbers(a.messageCount, b.messageCount, sortDir);
        case "cost":
          return compareNumbers(Number(a.costMicros), Number(b.costMicros), sortDir);
        case "signedCases":
          return compareNumbers(a.signedCases, b.signedCases, sortDir);
      }
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No leads matched this date range. Either no LSA clients are linked
        yet, or no daily data has been synced for the range.
      </div>
    );
  }

  return (
    <>
      {/* Mobile: stacked client cards. */}
      <div className="space-y-2 sm:hidden">
        {sortedRows.map((r) => (
          <div
            key={r.lsaClientId}
            className="rounded-md border bg-background p-3 text-sm"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="truncate font-medium">{r.lsaClientName}</div>
              <div className="text-right">
                <span className="text-[10px] uppercase text-muted-foreground">
                  Signed{" "}
                </span>
                <span className="font-semibold">{fmtNumber(r.signedCases)}</span>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="text-muted-foreground">Phone calls</div>
              <div className="text-right font-medium">
                {fmtNumber(r.phoneCallCount)}
              </div>
              <div className="text-muted-foreground">Messages</div>
              <div className="text-right font-medium">
                {fmtNumber(r.messageCount)}
              </div>
              <div className="text-muted-foreground">Cost</div>
              <div className="text-right font-medium">{fmtMicros(r.costMicros)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-md border sm:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortHeader
                label="Client"
                field="client"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Phone calls"
                align="right"
                field="phoneCallCount"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Messages"
                align="right"
                field="messageCount"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Cost"
                align="right"
                field="cost"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Signed"
                align="right"
                field="signedCases"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.lsaClientId} className="border-b last:border-0">
                <td className="px-3 py-2 align-middle">{r.lsaClientName}</td>
                <td className="px-3 py-2 text-right align-middle tabular-nums">
                  {fmtNumber(r.phoneCallCount)}
                </td>
                <td className="px-3 py-2 text-right align-middle tabular-nums">
                  {fmtNumber(r.messageCount)}
                </td>
                <td className="px-3 py-2 text-right align-middle tabular-nums">
                  {fmtMicros(r.costMicros)}
                </td>
                <td className="px-3 py-2 text-right align-middle tabular-nums">
                  {fmtNumber(r.signedCases)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
