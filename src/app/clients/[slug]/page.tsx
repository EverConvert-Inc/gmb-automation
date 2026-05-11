import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeatMapClient } from "@/components/heat-map-client";
import { LocationSwitcher } from "@/components/location-switcher";
import { ReviewInsightsCard } from "@/components/review-insights-card";
import { ScanManagementPanel } from "@/components/scan-management-panel";
import { ScanTrendCard } from "@/components/scan-trend-card";
import { StarBar } from "@/components/star-bar";
import { SyncReviewsButton } from "@/components/sync-reviews-button";
import {
  getActiveScanForLocation,
  getClientBySlug,
  getLocationWithLatestScan,
  getRecentScanComparisons,
  getReviewInsights,
  listGridConfigsForLocation,
  listKeywordsForLocation,
  listLocationsForClient,
  listRecentScansForLocation,
} from "@/lib/queries";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { formatRelativeDate, formatRelativeTime } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const client = await getClientBySlug(slug);
  return { title: client?.name ?? "Client" };
}

export default async function ClientDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    location?: string;
    just_added?: string;
    gbp_link?: "linked" | "no_match" | "failed" | string;
  }>;
}) {
  const [
    { slug },
    { location: locationParam, just_added: justAdded, gbp_link: gbpLink },
  ] = await Promise.all([params, searchParams]);
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  const locs = await listLocationsForClient(client.id);

  const totalReviews = locs.reduce((a, l) => a + l.reviewCount, 0);
  const ratingSum = locs.reduce(
    (a, l) => a + (l.rating !== null ? l.rating * l.reviewCount : 0),
    0,
  );
  const weightedRating = totalReviews > 0 ? ratingSum / totalReviews : null;

  if (locs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{client.name}</h1>
            <p className="text-sm text-muted-foreground">No locations yet</p>
          </div>
          <Link href={`/clients/${client.slug}/locations/new`}>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add location
            </Button>
          </Link>
        </div>
        <Card>
          <CardContent className="space-y-3 py-12 text-center text-sm text-muted-foreground">
            <p>No locations for this client yet.</p>
            <Link href={`/clients/${client.slug}/locations/new`}>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add the first location
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedId = locs.find((l) => l.id === locationParam)?.id ?? locs[0].id;
  const justAddedThis = justAdded === "1" && selectedId === locationParam;

  const data = await getLocationWithLatestScan(selectedId);
  if (!data) notFound();

  const {
    location,
    latestScan,
    points,
    completedPoints,
    recentReviews,
    rating,
    reviewCount,
  } = data;
  const [
    recentScans,
    allKeywords,
    gridConfigList,
    activeScan,
    reviewInsights,
    scanComparisons,
  ] = await Promise.all([
    listRecentScansForLocation(selectedId),
    listKeywordsForLocation(selectedId),
    listGridConfigsForLocation(selectedId),
    getActiveScanForLocation(selectedId),
    getReviewInsights(selectedId),
    getRecentScanComparisons(selectedId, 6),
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
  const latestScanKeywordIds = Array.from(new Set(points.map((p) => p.keywordId)));
  const hasGbpConnected = location.gbpOauthTokenId !== null;
  const hasNoReviews = reviewCount === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <StarBar rating={weightedRating} reviewCount={totalReviews} />
            <span>·</span>
            <span>
              {locs.length} location{locs.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <Link href={`/clients/${client.slug}/locations/new`}>
          <Button variant="outline">
            <Plus className="mr-2 h-4 w-4" /> Add location
          </Button>
        </Link>
      </div>

      <LocationSwitcher
        clientSlug={client.slug}
        locations={locs.map((l) => ({ id: l.id, name: l.name }))}
        currentLocationId={selectedId}
      />

      {justAddedThis && (
        <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
          <div className="flex-1">
            <div className="font-medium">{location.name} added.</div>
            <div className="mt-0.5 text-green-800">
              Run a scan below to populate the heat map. Reviews will sync once
              Google Business Profile is connected.
            </div>
          </div>
        </div>
      )}

      {gbpLink === "linked" && (
        <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
          <div className="flex-1">
            <div className="font-medium">Google Business Profile connected.</div>
            <div className="mt-0.5 text-green-800">
              Started the first review sync. Reviews will appear below within a
              few seconds — refresh if you don&rsquo;t see them yet.
            </div>
          </div>
        </div>
      )}
      {gbpLink === "no_match" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-medium">Google Business Profile connected, but no matching listing found.</div>
          <div className="mt-1 text-amber-800">
            The Google account you connected doesn&rsquo;t manage a business
            with this Place ID. Sign in with the account that owns this listing,
            or use &ldquo;Sync reviews&rdquo; below once you&rsquo;ve granted access.
          </div>
        </div>
      )}
      {gbpLink === "failed" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-medium">Connected, but couldn&rsquo;t auto-link this listing.</div>
          <div className="mt-1 text-amber-800">
            We saved the token but the GBP discovery call failed. Click
            &ldquo;Sync reviews&rdquo; below to retry, or check the server logs.
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{location.name}</h2>
          <p className="text-sm text-muted-foreground">{location.address}</p>
          {rating !== null ? (
            <StarBar rating={rating} reviewCount={reviewCount} />
          ) : hasGbpConnected ? (
            <p className="text-sm text-muted-foreground">
              Awaiting first review sync from Google.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No reviews yet. Connect Google Business Profile to start syncing.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            {hasGbpConnected ? (
              <>
                <Badge variant="success">GBP connected</Badge>
                <SyncReviewsButton locationId={location.id} />
              </>
            ) : (
              <Link href={`/api/oauth/google/start?locationId=${location.id}`}>
                <Button variant="outline">Connect Google Business Profile</Button>
              </Link>
            )}
          </div>
          {hasGbpConnected && (
            <div className="text-right text-xs">
              {location.lastPollError ? (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <AlertTriangle className="h-3 w-3" />
                  Last sync failed
                  {location.lastPollErrorAt &&
                    ` ${formatRelativeTime(location.lastPollErrorAt)}`}
                  {location.consecutivePollFailures > 1 &&
                    ` · ${location.consecutivePollFailures} attempts`}
                  <InfoTooltip aria-label="Error details">
                    {location.lastPollError}
                  </InfoTooltip>
                </span>
              ) : location.lastPolledAt ? (
                <span className="text-muted-foreground">
                  Last sync {formatRelativeTime(location.lastPolledAt)}
                  {location.nextPollAfter &&
                    ` · next ${formatRelativeTime(location.nextPollAfter)}`}
                </span>
              ) : (
                <span className="text-muted-foreground">Awaiting first sync</span>
              )}
            </div>
          )}
        </div>
      </div>

      <ReviewInsightsCard data={reviewInsights} />

      <Card>
        <CardHeader>
          <CardTitle>Heat Map</CardTitle>
        </CardHeader>
        <CardContent>
          <HeatMapClient
            key={location.id}
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

      <ScanTrendCard scans={scanComparisons} />

      <ScanManagementPanel
        key={location.id}
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
            <div className="space-y-3 py-6 text-center text-sm text-muted-foreground">
              <p>No reviews yet for this location.</p>
              {!hasGbpConnected && (
                <Link href={`/api/oauth/google/start?locationId=${location.id}`}>
                  <Button size="sm" variant="outline">
                    Connect Google Business Profile to sync reviews
                  </Button>
                </Link>
              )}
              {hasGbpConnected && hasNoReviews && (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xs">
                    Reviews sync automatically every day. Use the button below
                    to pull them now.
                  </p>
                  <SyncReviewsButton locationId={location.id} />
                </div>
              )}
            </div>
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
