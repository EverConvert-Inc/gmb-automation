"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { rankCellColor, rankCellOpacity } from "@/lib/metrics";

export type HeatMapPoint = {
  gridX: number;
  gridY: number;
  lat: number;
  lng: number;
  rank: number | null;
  status?: string | null;
  keywordId?: string;
  competitors?: Array<{ placeId: string; name: string; rank: number }>;
};

export type HeatMapProps = {
  centerLat: number;
  centerLng: number;
  points: HeatMapPoint[];
  zoom?: number;
  className?: string;
};

function rankLabel(status: string | null | undefined, rank: number | null): string {
  if (!status || status === "pending" || status === "queued") return "";
  if (status === "errored") return "!";
  if (rank === null) return "20+";
  if (rank > 20) return "20+";
  return String(rank);
}

function makeRankIcon(status: string | null | undefined, rank: number | null) {
  const color = rankCellColor(status, rank);
  const opacity = rankCellOpacity(status);
  const label = rankLabel(status, rank);
  const html = `<div style="background:${color};opacity:${opacity};width:30px;height:30px;border-radius:50%;border:1.5px solid #1f2937;color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${label}</div>`;
  return L.divIcon({
    className: "lvp-rank-marker",
    html,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function FitBounds({ points }: { points: HeatMapPoint[] }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40] });
    fittedRef.current = true;
  }, [map, points]);
  return null;
}

export function HeatMap({
  centerLat,
  centerLng,
  points,
  zoom = 12,
  className,
}: HeatMapProps) {
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

  // Belt-and-suspenders: react-leaflet's MapContainer is supposed to call
  // map.remove() on unmount, but under React 19 concurrent rendering it
  // can fail to do so if the parent subtree is replaced via key change —
  // leaving the leaflet DOM stuck on the page. Explicitly destroy the
  // map when this component unmounts.
  useEffect(() => {
    return () => {
      mapInstance?.remove();
    };
  }, [mapInstance]);

  return (
    <div className={className ?? "h-[600px] w-full overflow-hidden rounded-lg border"}>
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={zoom}
        scrollWheelZoom
        className="h-full w-full"
        ref={setMapInstance}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((p) => (
          <Marker
            key={`${p.gridX}-${p.gridY}-${p.keywordId ?? ""}`}
            position={[p.lat, p.lng]}
            icon={makeRankIcon(p.status, p.rank)}
          >
            <Popup>
              <div className="space-y-1 text-xs">
                <div className="font-semibold">
                  {p.status === "pending" || p.status === "queued"
                    ? "Pending…"
                    : p.status === "errored"
                      ? "Errored"
                      : p.rank !== null
                        ? `Rank: ${p.rank}`
                        : "Not in top results"}
                </div>
                {(() => {
                  // Build a single top-of-SERP list from stored competitors
                  // plus the user themselves (when they're ranked here), then
                  // sort by rank. This gives the *actual* top 3 at this grid
                  // point rather than the 3 closest competitors behind us.
                  const merged: Array<{
                    placeId: string;
                    name: string;
                    rank: number;
                    isSelf?: boolean;
                  }> = [...(p.competitors ?? [])];
                  if (p.rank !== null) {
                    merged.push({
                      placeId: "__self__",
                      name: "Your business",
                      rank: p.rank,
                      isSelf: true,
                    });
                  }
                  merged.sort((a, b) => a.rank - b.rank);
                  const top3 = merged.slice(0, 3);
                  if (top3.length === 0) return null;
                  return (
                    <div>
                      <div className="font-medium">Top 3 here</div>
                      <ol className="ml-4 list-decimal">
                        {top3.map((c) => (
                          <li
                            key={c.placeId}
                            className={
                              c.isSelf
                                ? "font-semibold text-green-700"
                                : undefined
                            }
                          >
                            {c.name} (#{c.rank})
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })()}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
