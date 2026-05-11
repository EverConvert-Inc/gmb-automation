"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, ExternalLink, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DeltaPill, NumericDeltaPill } from "@/components/charts";
import { RowActions } from "@/components/row-actions";
import { METRIC_DESCRIPTIONS } from "@/lib/metric-descriptions";
import { formatRelativeDate, cn } from "@/lib/utils";
import type { ClientRow, LocationSnapshot } from "@/lib/queries";

export function ClientsTable({
  rows,
  snapshots,
}: {
  rows: ClientRow[];
  // Plain object instead of Map so it crosses the server→client boundary
  // without manual serialization.
  snapshots: Record<string, LocationSnapshot[]>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left">
          <tr>
            <th className="w-px px-2 py-3" />
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Locations</th>
            <th className="px-4 py-3 font-medium">Rating</th>
            <th className="px-4 py-3 font-medium">Reviews</th>
            <th className="px-4 py-3 font-medium">Last scan</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="w-px px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const isExpanded = expanded.has(c.id);
            const clientLocs = snapshots[c.id] ?? [];
            return (
              <Fragment key={c.id}>
                <tr
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-controls={`client-${c.id}-locations`}
                  onClick={() => toggle(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(c.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer border-b last:border-0 transition-colors",
                    isExpanded ? "bg-muted/40" : "hover:bg-muted/30",
                  )}
                >
                  <td className="px-2 py-3 align-middle">
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        isExpanded && "rotate-90 text-foreground",
                      )}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{c.locationCount}</td>
                  <td className="px-4 py-3">
                    {c.weightedRating !== null ? c.weightedRating.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-3">{c.totalReviews}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.lastScanAt ? (
                      <>
                        {formatRelativeDate(c.lastScanAt)}
                        {c.locationCount > 1 && c.lastScanLocationName && (
                          <span className="ml-1 text-xs">
                            ({c.lastScanLocationName})
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={c.status === "active" ? "success" : "secondary"}>
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link href={`/clients/${c.slug}`}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="whitespace-nowrap"
                        >
                          View client
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <RowActions
                        entity="client"
                        id={c.id}
                        name={c.name}
                        cascadeDetail={`and its ${c.locationCount} location${c.locationCount === 1 ? "" : "s"} and ${c.totalReviews} review${c.totalReviews === 1 ? "" : "s"}`}
                      />
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr id={`client-${c.id}-locations`}>
                    <td
                      colSpan={8}
                      className="border-b bg-muted/10 px-4 py-4 last:border-0"
                    >
                      {clientLocs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No locations yet for this client.{" "}
                          <Link
                            href={`/clients/${c.slug}/locations/new`}
                            className="text-foreground underline hover:no-underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Add the first location →
                          </Link>
                        </p>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2">
                          {clientLocs.map((loc) => (
                            <LocationSnapshotCard
                              key={loc.id}
                              clientSlug={c.slug}
                              loc={loc}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function freshnessTone(days: number | null): string {
  if (days === null) return "text-muted-foreground";
  if (days <= 14) return "text-green-700";
  if (days <= 45) return "text-amber-700";
  return "text-red-700";
}

function LocationSnapshotCard({
  clientSlug,
  loc,
}: {
  clientSlug: string;
  loc: LocationSnapshot;
}) {
  const lastReviewLabel =
    loc.daysSinceLastReview === null
      ? "no reviews yet"
      : loc.daysSinceLastReview === 0
        ? "today"
        : `${loc.daysSinceLastReview}d ago`;

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate font-medium">{loc.name}</span>
            {loc.isGbpConnected ? (
              <Badge variant="success" className="shrink-0 px-1.5 py-px text-[10px]">
                GBP
              </Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0 px-1.5 py-px text-[10px]">
                no GBP
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {loc.address}
          </div>
        </div>
        <Link
          href={`/clients/${clientSlug}?location=${loc.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            className="h-7 whitespace-nowrap px-2 text-xs"
          >
            Open
            <ExternalLink className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Rating"
          info={METRIC_DESCRIPTIONS.rating}
          value={loc.rating !== null ? loc.rating.toFixed(1) : "—"}
          sub={`${loc.reviewCount} review${loc.reviewCount === 1 ? "" : "s"}`}
        />
        <Stat
          label="Last review"
          info={METRIC_DESCRIPTIONS.daysSinceLastReview}
          value={lastReviewLabel}
          valueClassName={freshnessTone(loc.daysSinceLastReview)}
        />
        <Stat
          label="Last 30d"
          info={METRIC_DESCRIPTIONS.reviewsLast30}
          value={String(loc.last30)}
          delta={<DeltaPill current={loc.last30} prior={loc.prior30} />}
        />
        <Stat
          label="Last 90d"
          info={METRIC_DESCRIPTIONS.reviewsLast90}
          value={String(loc.last90)}
          delta={<DeltaPill current={loc.last90} prior={loc.prior90} />}
        />
      </div>

      {loc.latestScan ? (
        <div className="rounded-md border bg-muted/20 p-2">
          <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Last scan</span>
            <span>
              {loc.latestScan.completedAt
                ? formatRelativeDate(loc.latestScan.completedAt)
                : "—"}{" "}
              · {loc.latestScan.rankedPoints}/{loc.latestScan.totalPoints} ranked
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ScanStat
              label="ARP"
              info={METRIC_DESCRIPTIONS.arp}
              value={
                loc.latestScan.arp !== null ? loc.latestScan.arp.toFixed(1) : "—"
              }
              delta={
                <NumericDeltaPill
                  current={loc.latestScan.arp}
                  prior={
                    loc.latestScan.arpDelta !== null && loc.latestScan.arp !== null
                      ? loc.latestScan.arp - loc.latestScan.arpDelta
                      : null
                  }
                  precision={1}
                  invert
                />
              }
            />
            <ScanStat
              label="SoLV"
              info={METRIC_DESCRIPTIONS.solv}
              value={`${loc.latestScan.solv.toFixed(0)}%`}
              delta={
                <NumericDeltaPill
                  current={loc.latestScan.solv}
                  prior={
                    loc.latestScan.solvDelta !== null
                      ? loc.latestScan.solv - loc.latestScan.solvDelta
                      : null
                  }
                  precision={1}
                />
              }
            />
            <ScanStat
              label="Coverage"
              info={METRIC_DESCRIPTIONS.coverage}
              value={`${loc.latestScan.coverage.toFixed(0)}%`}
              delta={
                <NumericDeltaPill
                  current={loc.latestScan.coverage}
                  prior={
                    loc.latestScan.coverageDelta !== null
                      ? loc.latestScan.coverage - loc.latestScan.coverageDelta
                      : null
                  }
                  precision={1}
                />
              }
            />
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
          No completed scans yet.{" "}
          <Link
            href={`/clients/${clientSlug}?location=${loc.id}#scan-new`}
            className="text-foreground underline hover:no-underline"
            onClick={(e) => e.stopPropagation()}
          >
            Run first scan →
          </Link>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  delta,
  info,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: React.ReactNode;
  info?: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {info && <InfoTooltip>{info}</InfoTooltip>}
      </div>
      <div className={cn("text-base font-semibold tabular-nums", valueClassName)}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{delta ?? sub ?? " "}</div>
    </div>
  );
}

function ScanStat({
  label,
  value,
  delta,
  info,
}: {
  label: string;
  value: string;
  delta: React.ReactNode;
  info?: string;
}) {
  return (
    <div className="rounded bg-background p-2">
      <div className="flex items-baseline justify-between gap-1">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>{label}</span>
          {info && <InfoTooltip>{info}</InfoTooltip>}
        </span>
        {delta}
      </div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
