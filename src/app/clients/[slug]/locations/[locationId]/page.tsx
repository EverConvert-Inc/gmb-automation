import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeatMapClient } from "@/components/heat-map-client";
import { ScanManagementPanel } from "@/components/scan-management-panel";
import { StarBar } from "@/components/star-bar";
import {
  getActiveScanForLocation,
  getClientBySlug,
  getLocationWithLatestScan,
  listGridConfigsForLocation,
  listKeywordsForLocation,
  listRecentScansForLocation,
} from "@/lib/queries";
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

  const {
    location,
    latestScan,
    points,
    completedPoints,
    recentReviews,
    rating,
    reviewCount,
  } = data;
  const [recentScans, allKeywords, gridConfigList, activeScan] = await Promise.all([
    listRecentScansForLocation(locationId),
    listKeywordsForLocation(locationId),
    listGridConfigsForLocation(locationId),
    getActiveScanForLocation(locationId),
  ]);

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
  const latestScanKeywordIds = Array.from(
    new Set(points.map((p) => p.keywordId)),
  );

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
        </div>
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

      <ScanManagementPanel
        locationId={location.id}
        allKeywords={allKeywords.map((k) => ({
          id: k.id,
          keyword: k.keyword,
          isPrimary: k.isPrimary,
        }))}
        gridConfigs={gridConfigList.map((g) => ({
          id: g.id,
          name: g.name,
          size: g.size,
          radiusMiles: Number(g.radiusMiles),
          isDefault: g.isDefault,
        }))}
        recentScans={recentScans.map((s) => ({
          id: s.id,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          status: s.status,
          triggeredBy: s.triggeredBy,
          totalKeywords: s.totalKeywords,
          totalPoints: s.totalPoints,
          gridConfigId: s.gridConfigId,
        }))}
        initialActiveScan={activeScan}
      />

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
  );
}

