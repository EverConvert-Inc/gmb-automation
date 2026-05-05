"use client";

import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { rankColor } from "@/lib/metrics";

export type HeatMapPoint = {
  gridX: number;
  gridY: number;
  lat: number;
  lng: number;
  rank: number | null;
  competitors?: Array<{ placeId: string; name: string; rank: number }>;
};

export type HeatMapProps = {
  centerLat: number;
  centerLng: number;
  points: HeatMapPoint[];
  zoom?: number;
  className?: string;
};

export function HeatMap({
  centerLat,
  centerLng,
  points,
  zoom = 12,
  className,
}: HeatMapProps) {
  return (
    <div className={className ?? "h-[600px] w-full overflow-hidden rounded-lg border"}>
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={zoom}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((p) => (
          <CircleMarker
            key={`${p.gridX}-${p.gridY}`}
            center={[p.lat, p.lng]}
            radius={14}
            pathOptions={{
              color: "#1f2937",
              weight: 1,
              fillColor: rankColor(p.rank),
              fillOpacity: 0.85,
            }}
          >
            <Popup>
              <div className="space-y-1 text-xs">
                <div className="font-semibold">
                  Rank: {p.rank ?? "20+"}
                </div>
                <div className="text-muted-foreground">
                  Cell ({p.gridX}, {p.gridY})
                </div>
                {p.competitors && p.competitors.length > 0 && (
                  <div>
                    <div className="font-medium">Top competitors</div>
                    <ol className="ml-4 list-decimal">
                      {p.competitors.slice(0, 3).map((c) => (
                        <li key={c.placeId}>
                          {c.name} (#{c.rank})
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
