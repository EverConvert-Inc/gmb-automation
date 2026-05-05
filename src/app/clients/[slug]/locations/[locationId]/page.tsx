import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeatMapClient } from "@/components/heat-map-client";
import {
  getClientBySlug,
  getLocationWithLatestScan,
  listRecentScansForLocation,
} from "@/lib/queries";
import { computeScanMetrics } from "@/lib/metrics";
import { formatRelativeDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ slug: string; locationId: string }>;
}) {
  const { slug, locationId } = await params;
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  const data = await getLocationWithLatestScan(locationId);
  if (!data || data.location.clientId !== client.id) notFound();

  const { location, latestScan, points, recentReviews } = data;
  const recentScans = await listRecentScansForLocation(locationId);

  const metrics = computeScanMetrics(points.map((p) => ({ rank: p.rank ?? null })));
  const heatMapPoints = points.map((p) => ({
    gridX: p.gridX,
    gridY: p.gridY,
    lat: Number(p.lat),
    lng: Number(p.lng),
    rank: p.rank ?? null,
    competitors: (p.competitorsJson as Array<{ placeId: string; name: string; rank: number }>) ?? [],
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{location.name}</h1>
          <p className="text-sm text-muted-foreground">{location.address}</p>
        </div>
        <div className="flex items-center gap-2">
          {location.gbpOauthTokenId ? (
            <Badge variant="success">GBP connected</Badge>
          ) : (
            <Link href={`/api/oauth/google/start?locationId=${location.id}`}>
              <Button variant="outline">Connect Google Business Profile</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="ARP" value={metrics.arp !== null ? metrics.arp.toFixed(1) : "—"} />
        <Stat
          label="SoLV"
          value={metrics.totalPoints ? `${metrics.solv.toFixed(0)}%` : "—"}
        />
        <Stat
          label="Coverage"
          value={metrics.totalPoints ? `${metrics.coverage.toFixed(0)}%` : "—"}
        />
        <Stat
          label="Last scan"
          value={latestScan ? formatRelativeDate(latestScan.completedAt) : "—"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Heat Map</CardTitle>
        </CardHeader>
        <CardContent>
          {heatMapPoints.length > 0 ? (
            <HeatMapClient
              centerLat={Number(location.lat)}
              centerLng={Number(location.lng)}
              points={heatMapPoints}
            />
          ) : (
            <div className="flex h-[400px] items-center justify-center text-sm text-muted-foreground">
              No scan data yet. Run a scan from the client view.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Scan history</CardTitle>
          </CardHeader>
          <CardContent>
            {recentScans.length === 0 ? (
              <div className="text-sm text-muted-foreground">No scans yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Started</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Triggered</th>
                  </tr>
                </thead>
                <tbody>
                  {recentScans.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="py-2">{formatRelativeDate(s.startedAt)}</td>
                      <td className="py-2">
                        <Badge
                          variant={
                            s.status === "completed"
                              ? "success"
                              : s.status === "errored"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {s.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground">{s.triggeredBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card id="reviews">
          <CardHeader>
            <CardTitle>Recent reviews</CardTitle>
          </CardHeader>
          <CardContent>
            {recentReviews.length === 0 ? (
              <div className="text-sm text-muted-foreground">No reviews yet.</div>
            ) : (
              <ul className="space-y-3">
                {recentReviews.map((r) => (
                  <li key={r.id} className="border-b pb-3 last:border-0">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">{r.reviewerName ?? "Anonymous"}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.rating}★ · {formatRelativeDate(r.createdAt)}
                      </div>
                    </div>
                    {r.text && (
                      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{r.text}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
