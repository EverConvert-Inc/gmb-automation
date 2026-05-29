"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { PpcReportRow } from "@/lib/queries";

type SortKey =
  | "client"
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

type ClientGroup = {
  ppcClientId: string;
  ppcClientName: string;
  clicks: number;
  impressions: number;
  conversions: number;
  phoneCalls: number;
  costMicros: bigint;
  signedCases: number | null;
  campaigns: PpcReportRow[];
};

// PPC table: default view is one row per client showing totals; click any
// client row to expand and reveal that client's per-campaign breakdown.
// Sort applies to the client totals; campaigns inside an expanded group are
// always sorted by campaign name.
export function PpcReportTable({ rows }: { rows: PpcReportRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("client");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(ppcClientId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ppcClientId)) next.delete(ppcClientId);
      else next.add(ppcClientId);
      return next;
    });
  }

  function onSort(field: SortKey) {
    if (field === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(field);
      setSortDir(field === "client" ? "asc" : "desc");
    }
  }

  // Group campaign rows by client and aggregate per-client totals.
  // signedCases is per-client and identical across that client's campaign
  // rows, so we grab whichever value the first row carries.
  const groups: ClientGroup[] = useMemo(() => {
    const map = new Map<string, ClientGroup>();
    for (const r of rows) {
      const cur = map.get(r.ppcClientId) ?? {
        ppcClientId: r.ppcClientId,
        ppcClientName: r.ppcClientName,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        phoneCalls: 0,
        costMicros: 0n,
        signedCases: r.signedCases,
        campaigns: [],
      };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      cur.conversions += r.conversions;
      cur.phoneCalls += r.phoneCalls;
      cur.costMicros += r.costMicros;
      cur.campaigns.push(r);
      map.set(r.ppcClientId, cur);
    }
    // Stable campaign-name sort inside each group.
    for (const g of map.values()) {
      g.campaigns.sort((a, b) => a.campaignName.localeCompare(b.campaignName));
    }
    return Array.from(map.values());
  }, [rows]);

  const sortedGroups = useMemo(() => {
    const arr = [...groups];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "client":
          return compareStrings(a.ppcClientName, b.ppcClientName, sortDir);
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
  }, [groups, sortKey, sortDir]);

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
      {/* Mobile: stacked client cards, tap to expand campaigns. */}
      <div className="space-y-2 sm:hidden">
        {sortedGroups.map((g) => {
          const open = expanded.has(g.ppcClientId);
          return (
            <div
              key={g.ppcClientId}
              className="rounded-md border bg-background text-sm"
            >
              <button
                type="button"
                onClick={() => toggleExpand(g.ppcClientId)}
                className="flex w-full items-start gap-2 p-3 text-left"
              >
                <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground">
                  {open ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="truncate font-medium">{g.ppcClientName}</div>
                    {g.signedCases !== null && (
                      <div className="text-right">
                        <span className="text-[10px] uppercase text-muted-foreground">
                          Signed{" "}
                        </span>
                        <span className="font-semibold">
                          {fmtNumber(g.signedCases)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {g.campaigns.length} campaign
                    {g.campaigns.length === 1 ? "" : "s"}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div className="text-muted-foreground">Phone calls</div>
                    <div className="text-right font-medium">
                      {fmtNumber(g.phoneCalls)}
                    </div>
                    <div className="text-muted-foreground">Conversions</div>
                    <div className="text-right font-medium">
                      {fmtConversions(g.conversions)}
                    </div>
                    <div className="text-muted-foreground">Clicks</div>
                    <div className="text-right font-medium">
                      {fmtNumber(g.clicks)}
                    </div>
                    <div className="text-muted-foreground">Cost</div>
                    <div className="text-right font-medium">
                      {fmtMicros(g.costMicros)}
                    </div>
                    <div className="text-muted-foreground">Impressions</div>
                    <div className="text-right font-medium">
                      {fmtNumber(g.impressions)}
                    </div>
                  </div>
                </div>
              </button>
              {open && (
                <div className="space-y-2 border-t bg-muted/20 p-3">
                  {g.campaigns.map((c) => (
                    <div
                      key={c.campaignId}
                      className="rounded-md border bg-background p-2.5 text-xs"
                    >
                      <div className="font-medium">{c.campaignName}</div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                        <div className="text-muted-foreground">Phone calls</div>
                        <div className="text-right">
                          {fmtNumber(c.phoneCalls)}
                        </div>
                        <div className="text-muted-foreground">Conversions</div>
                        <div className="text-right">
                          {fmtConversions(c.conversions)}
                        </div>
                        <div className="text-muted-foreground">Clicks</div>
                        <div className="text-right">{fmtNumber(c.clicks)}</div>
                        <div className="text-muted-foreground">Cost</div>
                        <div className="text-right">{fmtMicros(c.costMicros)}</div>
                        <div className="text-muted-foreground">Impressions</div>
                        <div className="text-right">
                          {fmtNumber(c.impressions)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-md border sm:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-2" />
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
            {sortedGroups.map((g) => {
              const open = expanded.has(g.ppcClientId);
              return (
                <ClientRows
                  key={g.ppcClientId}
                  group={g}
                  open={open}
                  onToggle={() => toggleExpand(g.ppcClientId)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ClientRows({
  group,
  open,
  onToggle,
}: {
  group: ClientGroup;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b font-medium hover:bg-muted/30"
        onClick={onToggle}
      >
        <td className="w-8 px-2 py-2 align-middle text-muted-foreground">
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        <td className="px-3 py-2 align-middle">
          {group.ppcClientName}
          <span className="ml-2 text-[10px] font-normal text-muted-foreground">
            {group.campaigns.length} campaign
            {group.campaigns.length === 1 ? "" : "s"}
          </span>
        </td>
        <td className="px-3 py-2 text-right align-middle tabular-nums">
          {fmtNumber(group.phoneCalls)}
        </td>
        <td className="px-3 py-2 text-right align-middle tabular-nums">
          {fmtConversions(group.conversions)}
        </td>
        <td className="px-3 py-2 text-right align-middle tabular-nums">
          {fmtNumber(group.clicks)}
        </td>
        <td className="px-3 py-2 text-right align-middle tabular-nums">
          {fmtMicros(group.costMicros)}
        </td>
        <td className="px-3 py-2 text-right align-middle tabular-nums">
          {fmtNumber(group.impressions)}
        </td>
        <td className="px-3 py-2 text-right align-middle tabular-nums">
          {group.signedCases === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            fmtNumber(group.signedCases)
          )}
        </td>
      </tr>
      {open &&
        group.campaigns.map((c) => (
          <tr
            key={c.campaignId}
            className="border-b bg-muted/10 text-xs text-muted-foreground last:border-0"
          >
            <td className="px-2 py-1.5" />
            <td className="px-3 py-1.5 pl-8 align-middle">
              <span className="text-foreground">{c.campaignName}</span>
            </td>
            <td className="px-3 py-1.5 text-right align-middle tabular-nums">
              {fmtNumber(c.phoneCalls)}
            </td>
            <td className="px-3 py-1.5 text-right align-middle tabular-nums">
              {fmtConversions(c.conversions)}
            </td>
            <td className="px-3 py-1.5 text-right align-middle tabular-nums">
              {fmtNumber(c.clicks)}
            </td>
            <td className="px-3 py-1.5 text-right align-middle tabular-nums">
              {fmtMicros(c.costMicros)}
            </td>
            <td className="px-3 py-1.5 text-right align-middle tabular-nums">
              {fmtNumber(c.impressions)}
            </td>
            <td className="px-3 py-1.5 text-right align-middle">
              <span className="text-muted-foreground/40">·</span>
            </td>
          </tr>
        ))}
    </>
  );
}
