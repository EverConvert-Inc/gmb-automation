import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeatMapClient } from "@/components/heat-map-client";
import { RowActions } from "@/components/row-actions";
import { Sparkline, VelocityDelta } from "@/components/sparkline";
import { StarBar } from "@/components/star-bar";
import {
  getClientBySlug,
  getLocationReviewStats,
  getLocationWeeklyReviews,
  getLocationWithLatestScan,
  listKeywordsForLocation,
  listRecentScansForLocation,
} from "@/lib/queries";
import { computeScanMetrics } from "@/lib/metrics";
import { formatRelativeDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locationId: string }>;
}): Promise<Metadata> {
  const { locationId } = await params;
  const data = await getLocationWithLatestScan(locationId);
  return { title: data?.location.name ?? "Location" };
}

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

  const {
    location,
    latestScan,
    points,
    completedPoints,
    recentReviews,
    rating,
    reviewCount,
  } = data;
  const [recentScans, reviewStats, weekly, allKeywords] = await Promise.all([
    listRecentScansForLocation(locationId),
    getLocationReviewStats(locationId),
    getLocationWeeklyReviews(locationId, 12),
    listKeywordsForLocation(locationId),
  ]);

  const metrics = computeScanMetrics(points.map((p) => ({ rank: p.rank ?? null })));
  const heatMapPoints = points.map((p) => ({
    gridX: p.gridX,
    gridY: p.gridY,
    lat: Number(p.lat),
    lng: Number(p.lng),
    rank: p.rank ?? null,
    status: p.status,
    keywordId: p.keywordId,
    competitors:
      (p.competitorsJson as Array<{ placeId: string; name: string; rank: number }>) ?? [],
  }));
  const latestScanKeywordIds = Array.from(new Set(points.map((p) => p.keywordId)));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{location.name}</h1>
          <p className="text-sm text-muted-foreground">{location.address}</p>
          <StarBar rating={rating} reviewCount={reviewCount} />
        </div>
        <div className="flex items-center gap-2">
          {location.gbpOauthTokenId ? (
            <Badge variant="success">GBP connected</Badge>
          ) : (
            <Link href={`/api/oauth/google/start?locationId=${location.id}`}>
              <Button variant="outline">Connect Google Business Profile</Button>
            </Link>
          )}
          <RowActions
            entity="location"
            id={location.id}
            name={location.name}
            cascadeDetail="and all its reviews and scan history"
            redirectTo={`/clients/${slug}`}
          />
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

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">Reviews 30d</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{reviewStats.this30}</span>
              <span className="text-sm">
                <VelocityDelta this30={reviewStats.this30} prior30={reviewStats.prior30} />
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              vs {reviewStats.prior30} prior 30
            </div>
          </CardContent>
        </Card>
        <Stat label="Reviews 90d" value={String(reviewStats.this90)} />
        <Stat
          label="Days since last"
          value={
            reviewStats.daysSinceLastReview === null
              ? "—"
              : String(reviewStats.daysSinceLastReview)
          }
        />
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">12-week trend</div>
            <div className="mt-2">
              <Sparkline data={weekly.map((w) => w.count)} height={40} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Heat Map</CardTitle>
        </CardHeader>
        <CardContent>
          <HeatMapClient
            locationId={location.id}
            centerLat={Number(location.lat)}
            centerLng={Number(location.lng)}
            initialPoints={heatMapPoints}
            initialStatus={latestScan?.status ?? null}
            initialCompletedPoints={completedPoints}
            keywords={allKeywords.map((k) => ({
              id: k.id,
              keyword: k.keyword,
              isPrimary: k.isPrimary,
            }))}
            latestScanKeywordIds={latestScanKeywordIds}
            latestScanCompletedAt={latestScan?.completedAt ?? null}
          />
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
