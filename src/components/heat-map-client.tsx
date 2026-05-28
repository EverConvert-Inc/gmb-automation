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
  keywordIds: string[];
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
  const [scanLoadError, setScanLoadError] = useState<string | null>(null);
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
    // When the parent server-component re-runs (e.g. after the user
    // dispatches a new scan via router.refresh), a new latestScanId arrives
    // as a prop. The local mirror state was only seeded at mount, so without
    // this re-sync `status` stays at the previous scan's "completed" forever
    // and the polling effect below never fires. Only re-sync on scan-id
    // change — during a live scan, the polling effect is authoritative.
    setStatus(initialStatus);
    setPoints(initialPoints);
    setCompletedPoints(initialCompletedPoints);
    setCompletedAt(latestScanCompletedAt);
    setViewingScanId(latestScanId);
    setScanKeywordIds(latestScanKeywordIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestScanId]);

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
    setScanLoadError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
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
        { cache: "no-store", signal: controller.signal },
      );
      if (!res.ok) {
        setScanLoadError(`Couldn't load that scan (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as {
        scan: { status: string; completedAt: string | null } | null;
        points: HeatMapPoint[];
        completedPoints: number;
      };
      if (!data.scan) {
        setScanLoadError("Scan not found");
        return;
      }
      setPoints(data.points);
      setCompletedAt(data.scan.completedAt);
      setCompletedPoints(data.completedPoints);
      setStatus(data.scan.status);
      setScanKeywordIds(Array.from(new Set(data.points.map((p) => p.keywordId ?? ""))));
      setViewingScanId(scanId);
    } catch (err) {
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";
      setScanLoadError(
        isAbort ? "Request timed out" : (err as Error).message ?? "Load failed",
      );
    } finally {
      clearTimeout(timeoutId);
      setScanLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedKeywordId && (primaryInScan || fallbackKeywordId)) {
      setSelectedKeywordId(primaryInScan ?? fallbackKeywordId);
    }
  }, [selectedKeywordId, primaryInScan, fallbackKeywordId]);

  // If the user is viewing a historical scan and switches to a keyword that
  // scan didn't include, fall back to the latest scan automatically — the
  // historical view has nothing useful to show for the new keyword.
  useEffect(() => {
    if (!selectedKeywordId || !viewingScanId || viewingScanId === latestScanId) {
      return;
    }
    const current = recentScans.find((s) => s.id === viewingScanId);
    if (current && !current.keywordIds.includes(selectedKeywordId) && latestScanId) {
      void loadScan(latestScanId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeywordId]);

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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
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

      {(() => {
        // Only show the picker if more than one of the recent scans actually
        // covered the currently-selected keyword. Pills for scans that don't
        // include this keyword would just dump you into an empty map.
        if (!selectedKeywordId) return null;
        const visible = recentScans.filter(
          (s) =>
            s.id === latestScanId || s.keywordIds.includes(selectedKeywordId),
        );
        if (visible.length <= 1) return null;
        return (
          <ScanPicker
            scans={visible}
            latestScanId={latestScanId}
            selectedId={viewingScanId}
            loading={scanLoading}
            error={scanLoadError}
            onSelect={loadScan}
          />
        );
      })()}

      {scannedKeywords.length >= 1 && (
        <HeatMapKeywordTabs
          keywords={scannedKeywords}
          selectedId={selectedKeywordId}
          onSelect={setSelectedKeywordId}
        />
      )}

      {isRunning && (
        <div className="text-xs text-muted-foreground">
          Scan in progress · {completedPoints}/{points.length} points complete · live
        </div>
      )}

      {filteredPoints.length > 0 ? (
        <>
          <HeatMap
            centerLat={centerLat}
            centerLng={centerLng}
            points={filteredPoints}
            zoom={zoom}
          />
          <HeatMapLegend />
        </>
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

function HeatMapLegend() {
  const items: Array<{ color: string; label: string }> = [
    { color: "#22c55e", label: "1–3" },
    { color: "#facc15", label: "4–10" },
    { color: "#fb923c", label: "11–20" },
    { color: "#ef4444", label: "20+" },
    { color: "#9ca3af", label: "pending" },
    { color: "#4b5563", label: "error" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium uppercase tracking-wide text-foreground">
        Rank legend
      </span>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-full border border-border"
            style={{ backgroundColor: i.color }}
          />
          {i.label}
        </span>
      ))}
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
  error,
  onSelect,
}: {
  scans: ScanOption[];
  latestScanId: string | null;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
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
      {loading && <span className="text-muted-foreground">Loading…</span>}
      {error && !loading && <span className="text-red-600">{error}</span>}
    </div>
  );
}
