"use client";

import { useMemo, useState } from "react";
import type { PpcReportRow } from "@/lib/queries";

type SortKey =
  | "client"
  | "campaign"
  | "phoneCalls"
  | "conversions"
  | "clicks"
  | "cost"
  | "impressions"
  | "signedCases";

type SortDir = "asc" | "desc";

const NUMBER_FMT = new Intl.NumberFormat();
function fmtNumber(n: number): string {
  return NUMBER_FMT.format(n);
}
function fmtConversions(n: number): string {
  return n % 1 === 0 ? fmtNumber(n) : n.toFixed(1);
}
function fmtMicros(microsBig: bigint): string {
  // Convert micros to dollars with two decimal places.
  const dollars = Number(microsBig / 10_000n) / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(dollars);
}

function compareNumbers(a: number | null, b: number | null, dir: SortDir): number {
  const av = a ?? 0;
  const bv = b ?? 0;
  return dir === "asc" ? av - bv : bv - av;
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

// PPC table: one row per (client × campaign) for the active date range.
// Sortable. "Signed cases" is shown only on the first row per client to avoid
// double-counting visually. Mobile collapses to a card per campaign.
export function PpcReportTable({ rows }: { rows: PpcReportRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("client");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function onSort(field: SortKey) {
    if (field === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(field);
      setSortDir(field === "client" || field === "campaign" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "client":
          return (
            compareStrings(a.ppcClientName, b.ppcClientName, sortDir) ||
            compareStrings(a.campaignName, b.campaignName, "asc")
          );
        case "campaign":
          return compareStrings(a.campaignName, b.campaignName, sortDir);
        case "phoneCalls":
          return compareNumbers(a.phoneCalls, b.phoneCalls, sortDir);
        case "conversions":
          return compareNumbers(a.conversions, b.conversions, sortDir);
        case "clicks":
          return compareNumbers(a.clicks, b.clicks, sortDir);
        case "cost":
          return compareNumbers(
            Number(a.costMicros),
            Number(b.costMicros),
            sortDir,
          );
        case "impressions":
          return compareNumbers(a.impressions, b.impressions, sortDir);
        case "signedCases":
          return compareNumbers(a.signedCases, b.signedCases, sortDir);
      }
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  // Build a flag map so signed-case totals appear once per client even when
  // the table is sorted by something other than client name.
  const firstRowSeen = useMemo(() => {
    const seen = new Set<string>();
    const flag = new Array(sorted.length).fill(false);
    sorted.forEach((r, i) => {
      if (!seen.has(r.ppcClientId)) {
        seen.add(r.ppcClientId);
        flag[i] = true;
      }
    });
    return flag;
  }, [sorted]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No campaigns matched this date range. Either no PPC clients are linked
        yet, or no daily data has been synced for the range.
      </div>
    );
  }

  return (
    <>
      {/* Mobile card-per-row */}
      <div className="space-y-2 sm:hidden">
        {sorted.map((r, i) => (
          <div key={r.campaignId} className="rounded-md border bg-background p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.campaignName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {r.ppcClientName}
                </div>
              </div>
              {firstRowSeen[i] && r.signedCases !== null && (
                <div className="text-right">
                  <div className="text-[10px] uppercase text-muted-foreground">
                    Signed
                  </div>
                  <div className="text-base font-semibold">
                    {fmtNumber(r.signedCases)}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="text-muted-foreground">Phone calls</div>
              <div className="text-right font-medium">
                {fmtNumber(r.phoneCalls)}
              </div>
              <div className="text-muted-foreground">Conversions</div>
              <div className="text-right font-medium">
                {fmtConversions(r.conversions)}
              </div>
              <div className="text-muted-foreground">Clicks</div>
              <div className="text-right font-medium">{fmtNumber(r.clicks)}</div>
              <div className="text-muted-foreground">Cost</div>
              <div className="text-right font-medium">
                {fmtMicros(r.costMicros)}
              </div>
              <div className="text-muted-foreground">Impressions</div>
              <div className="text-right font-medium">
                {fmtNumber(r.impressions)}
              </div>
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
                label="Campaign"
                field="campaign"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Phone calls"
                align="right"
                field="phoneCalls"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Conversions"
                align="right"
                field="conversions"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Clicks"
                align="right"
                field="clicks"
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
                label="Impressions"
                align="right"
                field="impressions"
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
            {sorted.map((r, i) => (
              <tr key={r.campaignId} className="border-b last:border-0">
                <td className="px-3 py-2 align-top">{r.ppcClientName}</td>
                <td className="px-3 py-2 align-top">{r.campaignName}</td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {fmtNumber(r.phoneCalls)}
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {fmtConversions(r.conversions)}
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {fmtNumber(r.clicks)}
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {fmtMicros(r.costMicros)}
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {fmtNumber(r.impressions)}
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {firstRowSeen[i] ? (
                    r.signedCases === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      fmtNumber(r.signedCases)
                    )
                  ) : (
                    <span className="text-muted-foreground/40">·</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
