"use client";

import { useMemo, useState } from "react";
import type { CallQualityClientRow } from "@/lib/queries-call-quality";

type SortKey =
  | "client"
  | "firstTimeCalls"
  | "real"
  | "junk"
  | "cost"
  | "realCpl"
  | "adsCpa";

type SortDir = "asc" | "desc";

const NUMBER_FMT = new Intl.NumberFormat();
function fmtNumber(n: number): string {
  return NUMBER_FMT.format(n);
}
function fmtUsdFromMicros(micros: bigint): string {
  const dollars = Number(micros / 10_000n) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}
function fmtUsdOrDash(dollars: number | null): string {
  if (dollars === null) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(dollars);
}

function compareNumbers(a: number, b: number, dir: SortDir): number {
  return dir === "asc" ? a - b : b - a;
}
function compareNullableNumbers(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  // Nulls always sort last, regardless of direction — "—" isn't a
  // meaningful high or low value to rank against real numbers.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareNumbers(a, b, dir);
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

// One row per client, aggregated over the selected date range. showCost
// hides the Cost/Signed CPL/Ads CPA columns entirely for GMB (organic, no
// ad spend) and PMax (spend not isolated from the rest of the PPC account
// yet — see queries-call-quality.ts's finalize()).
export function CallQualityClientTable({
  rows,
  showCost,
}: {
  rows: CallQualityClientRow[];
  showCost: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("real");
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
          return compareStrings(a.clientName, b.clientName, sortDir);
        case "firstTimeCalls":
          return compareNumbers(a.firstTimeCalls, b.firstTimeCalls, sortDir);
        case "real":
          return compareNumbers(a.real, b.real, sortDir);
        case "junk":
          return compareNumbers(a.junk, b.junk, sortDir);
        case "cost":
          return compareNumbers(Number(a.costMicros), Number(b.costMicros), sortDir);
        case "realCpl":
          return compareNullableNumbers(a.realCostPerRealLead, b.realCostPerRealLead, sortDir);
        case "adsCpa":
          return compareNullableNumbers(a.adsReportedCpa, b.adsReportedCpa, sortDir);
      }
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No clients linked to CallRail for this channel yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
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
              label="First-time calls"
              align="right"
              field="firstTimeCalls"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Signed"
              align="right"
              field="real"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Junk"
              align="right"
              field="junk"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            {showCost && (
              <>
                <SortHeader
                  label="Cost"
                  align="right"
                  field="cost"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortHeader
                  label="Signed CPL"
                  align="right"
                  field="realCpl"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortHeader
                  label="Ads CPA"
                  align="right"
                  field="adsCpa"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => (
            <tr key={r.clientId} className="border-b last:border-0">
              <td className="px-3 py-2 align-middle">{r.clientName}</td>
              <td className="px-3 py-2 text-right align-middle tabular-nums">
                {fmtNumber(r.firstTimeCalls)}
              </td>
              <td className="px-3 py-2 text-right align-middle tabular-nums">
                {fmtNumber(r.real)}
              </td>
              <td className="px-3 py-2 text-right align-middle tabular-nums">
                {fmtNumber(r.junk)}
              </td>
              {showCost && (
                <>
                  <td className="px-3 py-2 text-right align-middle tabular-nums">
                    {fmtUsdFromMicros(r.costMicros)}
                  </td>
                  <td className="px-3 py-2 text-right align-middle tabular-nums">
                    {fmtUsdOrDash(r.realCostPerRealLead)}
                  </td>
                  <td className="px-3 py-2 text-right align-middle tabular-nums">
                    {fmtUsdOrDash(r.adsReportedCpa)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
