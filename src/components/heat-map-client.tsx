"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { HeatMapPoint } from "./heat-map";

const HeatMap = dynamic(() => import("./heat-map").then((m) => m.HeatMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] w-full items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

type Props = {
  locationId: string;
  centerLat: number;
  centerLng: number;
  initialPoints: HeatMapPoint[];
  initialStatus: string | null;
  initialCompletedPoints: number;
  zoom?: number;
};

export function HeatMapClient({
  locationId,
  centerLat,
  centerLng,
  initialPoints,
  initialStatus,
  initialCompletedPoints,
  zoom,
}: Props) {
  const [points, setPoints] = useState(initialPoints);
  const [status, setStatus] = useState(initialStatus);
  const [completedPoints, setCompletedPoints] = useState(initialCompletedPoints);

  useEffect(() => {
    if (status !== "running" && status !== "queued") return;

    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/locations/${locationId}/scan`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          scan: { status: string } | null;
          points: HeatMapPoint[];
          completedPoints: number;
        };
        if (cancelled || !data.scan) return;
        setStatus(data.scan.status);
        setPoints(data.points);
        setCompletedPoints(data.completedPoints);
      } catch {
        // ignore transient failures
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [locationId, status]);

  const isRunning = status === "running" || status === "queued";

  return (
    <div className="space-y-2">
      {isRunning && (
        <div className="text-xs text-muted-foreground">
          Scan in progress · {completedPoints}/{points.length} points complete · live
        </div>
      )}
      {points.length > 0 ? (
        <HeatMap
          centerLat={centerLat}
          centerLng={centerLng}
          points={points}
          zoom={zoom}
        />
      ) : (
        <div className="flex h-[600px] items-center justify-center text-sm text-muted-foreground">
          No scan data yet. Run a scan from the client view.
        </div>
      )}
    </div>
  );
}
