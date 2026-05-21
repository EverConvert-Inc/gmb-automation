"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { HeatMapKeywordTabs, type KeywordTab } from "./heat-map-keyword-tabs";
import { computeScanMetrics } from "@/lib/metrics";
import { METRIC_DESCRIPTIONS } from "@/lib/metric-descriptions";
import { formatRelativeDate } from "@/lib/utils";
import type { HeatMapPoint } from "./heat-map";

const HeatMap = dynamic(() => import("./heat-map").then((m) => m.HeatMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] w-full items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

type ScanOption = {
  id: string;
  completedAt: Date | string | null;
  startedAt: Date | string;
};

type Props = {
  locationId: string;
  centerLat: number;
  centerLng: number;
  initialPoints: HeatMapPoint[];
  initialStatus: string | null;
  initialCompletedPoints: number;
  keywords: KeywordTab[];
  latestScanKeywordIds: string[];
  latestScanCompletedAt: Date | string | null;
  latestScanId: string | null;
  recentScans: ScanOption[];
  zoom?: number;
};

export function HeatMapClient({
  locationId,
  centerLat,
  centerLng,
  initialPoints,
  initialStatus,
  initialCompletedPoints,
  keywords,
  latestScanKeywordIds,
  latestScanCompletedAt,
  latestScanId,
  recentScans,
  zoom,
}: Props) {
  const [points, setPoints] = useState(initialPoints);
  const [status, setStatus] = useState(initialStatus);
  const [completedAt, setCompletedAt] = useState(latestScanCompletedAt);
  const [completedPoints, setCompletedPoints] = useState(initialCompletedPoints);
  const [viewingScanId, setViewingScanId] = useState<string | null>(latestScanId);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanKeywordIds, setScanKeywordIds] = useState<string[]>(latestScanKeywordIds);

  const isViewingLatest = viewingScanId === latestScanId;

  const scannedKeywords = useMemo(() => {
    const inScan = new Set(scanKeywordIds);
    return keywords.filter((k) => inScan.has(k.id));
  }, [keywords, scanKeywordIds]);

  const fallbackKeywordId = scannedKeywords[0]?.id ?? keywords[0]?.id ?? null;
  const primaryInScan = scannedKeywords.find((k) => k.isPrimary)?.id ?? null;

  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(
    primaryInScan ?? fallbackKeywordId,
  );

  useEffect(() => {
    // Only poll while the latest scan is in progress. Stop polling when the
    // user is browsing an older scan — that view is static.
    if (!isViewingLatest) return;
    if (status !== "running" && status !== "queued") return;

    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/locations/${locationId}/scan`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          scan: { status: string; completedAt: string | null } | null;
          points: HeatMapPoint[];
          completedPoints: number;
        };
        if (cancelled || !data.scan) return;
        setStatus(data.scan.status);
        setPoints(data.points);
        setCompletedPoints(data.completedPoints);
        if (data.scan.completedAt) setCompletedAt(data.scan.completedAt);
      } catch {
        // ignore transient failures
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [locationId, status, isViewingLatest]);

  async function loadScan(scanId: string) {
    if (scanId === viewingScanId) return;
    setScanLoading(true);
    try {
      if (scanId === latestScanId) {
        // Restore the latest scan view from the props snapshot.
        setPoints(initialPoints);
        setCompletedAt(latestScanCompletedAt);
        setCompletedPoints(initialCompletedPoints);
        setStatus(initialStatus);
        setScanKeywordIds(latestScanKeywordIds);
        setViewingScanId(scanId);
        return;
      }
      const res = await fetch(
        `/api/locations/${locationId}/scan?scanId=${encodeURIComponent(scanId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        scan: { status: string; completedAt: string | null } | null;
        points: HeatMapPoint[];
        completedPoints: number;
      };
      if (!data.scan) return;
      setPoints(data.points);
      setCompletedAt(data.scan.completedAt);
      setCompletedPoints(data.completedPoints);
      setStatus(data.scan.status);
      setScanKeywordIds(Array.from(new Set(data.points.map((p) => p.keywordId ?? ""))));
      setViewingScanId(scanId);
    } finally {
      setScanLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedKeywordId && (primaryInScan || fallbackKeywordId)) {
      setSelectedKeywordId(primaryInScan ?? fallbackKeywordId);
    }
  }, [selectedKeywordId, primaryInScan, fallbackKeywordId]);

  const isRunning = status === "running" || status === "queued";

  const filteredPoints = useMemo(() => {
    if (!selectedKeywordId) return points;
    return points.filter((p) => p.keywordId === selectedKeywordId);
  }, [points, selectedKeywordId]);

  const metrics = useMemo(
    () => computeScanMetrics(filteredPoints.map((p) => ({ rank: p.rank ?? null }))),
    [filteredPoints],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <Stat
          label="ARP"
          info={METRIC_DESCRIPTIONS.arp}
          value={metrics.arp !== null ? metrics.arp.toFixed(1) : "—"}
        />
        <Stat
          label="SoLV"
          info={METRIC_DESCRIPTIONS.solv}
          value={metrics.totalPoints ? `${metrics.solv.toFixed(0)}%` : "—"}
        />
        <Stat
          label="Coverage"
          info={METRIC_DESCRIPTIONS.coverage}
          value={metrics.totalPoints ? `${metrics.coverage.toFixed(0)}%` : "—"}
        />
        <Stat
          label="Last scan"
          info={METRIC_DESCRIPTIONS.lastScan}
          value={completedAt ? formatRelativeDate(completedAt) : "—"}
        />
      </div>

      {recentScans.length > 1 && (
        <ScanPicker
          scans={recentScans}
          latestScanId={latestScanId}
          selectedId={viewingScanId}
          loading={scanLoading}
          onSelect={loadScan}
        />
      )}

      {scannedKeywords.length > 1 && (
        <HeatMapKeywordTabs
          keywords={scannedKeywords}
          selectedId={selectedKeywordId}
          onSelect={setSelectedKeywordId}
        />
      )}

      {selectedKeywordId && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="uppercase tracking-wide">Showing rankings for</span>
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-medium text-foreground">
            &ldquo;
            {keywords.find((k) => k.id === selectedKeywordId)?.keyword ?? "—"}
            &rdquo;
          </span>
          {scannedKeywords.length === 1 && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              (only keyword scanned)
            </span>
          )}
        </div>
      )}

      {isRunning && (
        <div className="text-xs text-muted-foreground">
          Scan in progress · {completedPoints}/{points.length} points complete · live
        </div>
      )}

      {filteredPoints.length > 0 ? (
        <HeatMap
          centerLat={centerLat}
          centerLng={centerLng}
          points={filteredPoints}
          zoom={zoom}
        />
      ) : (
        <div className="flex h-[600px] items-center justify-center text-sm text-muted-foreground">
          {points.length === 0
            ? "No scan data yet. Use the scan management panel below to run one."
            : "No data for the selected keyword on this scan."}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  info,
}: {
  label: string;
  value: string;
  info?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
          <span>{label}</span>
          {info && <InfoTooltip>{info}</InfoTooltip>}
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function ScanPicker({
  scans,
  latestScanId,
  selectedId,
  loading,
  onSelect,
}: {
  scans: ScanOption[];
  latestScanId: string | null;
  selectedId: string | null;
  loading: boolean;
  onSelect: (scanId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="uppercase tracking-wide text-muted-foreground">
        Viewing scan
      </span>
      <div className="flex flex-wrap gap-1.5">
        {scans.map((s) => {
          const isSelected = s.id === selectedId;
          const isLatest = s.id === latestScanId;
          const when = s.completedAt ?? s.startedAt;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              disabled={loading}
              className={
                isSelected
                  ? "rounded-full border border-brand bg-brand/10 px-2.5 py-0.5 font-medium text-foreground"
                  : "rounded-full border border-border bg-background px-2.5 py-0.5 text-muted-foreground hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
              }
            >
              {isLatest ? "Latest" : formatRelativeDate(when)}
            </button>
          );
        })}
      </div>
      {loading && (
        <span className="text-muted-foreground">Loading…</span>
      )}
    </div>
  );
}
