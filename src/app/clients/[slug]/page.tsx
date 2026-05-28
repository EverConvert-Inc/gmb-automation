import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { HeatMapClient } from "@/components/heat-map-client";
import { LocationSwitcher } from "@/components/location-switcher";
import { ReviewInsightsCard } from "@/components/review-insights-card";
import { ReviewsTriageCard } from "@/components/reviews-triage-card";
import { ScanManagementPanel } from "@/components/scan-management-panel";
import { SectionCard } from "@/components/ui/section-card";
import { StarBar } from "@/components/star-bar";
import { SyncAllLocationsButton } from "@/components/sync-all-locations-button";
import {
  getActiveScanForLocation,
  getClientBySlug,
  getLocationWithLatestScan,
  getReviewInsights,
  getRankingsOverview,
  listGridConfigsForLocation,
  listKeywordsForLocation,
  listLocationsForClient,
  listRecentScansForLocation,
  listScanKeywordIds,
} from "@/lib/queries";
import { SerpRankingsCard } from "@/components/serp-rankings-card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { formatRelativeTime } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Map, Plus } from "lucide-react";

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
          <Link
            href={`/clients/${client.slug}/locations/new`}
            className={buttonClasses()}
          >
            <Plus className="mr-2 h-4 w-4" /> Add location
          </Link>
        </div>
        <Card>
          <CardContent className="space-y-3 py-12 text-center text-sm text-muted-foreground">
            <p>No locations for this client yet.</p>
            <Link
              href={`/clients/${client.slug}/locations/new`}
              className={buttonClasses()}
            >
              <Plus className="mr-2 h-4 w-4" /> Add the first location
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
    serpRankings,
  ] = await Promise.all([
    listRecentScansForLocation(selectedId),
    listKeywordsForLocation(selectedId),
    listGridConfigsForLocation(selectedId),
    getActiveScanForLocation(selectedId),
    getReviewInsights(selectedId),
    getRankingsOverview(client.id),
  ]);

  const completedRecent = recentScans
    .filter((s) => s.status === "completed")
    .slice(0, 8);
  const scanKeywordMap = await listScanKeywordIds(completedRecent.map((s) => s.id));

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
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
        <div className="flex flex-wrap items-start gap-3">
          <SyncAllLocationsButton
            clientId={client.id}
            connectedCount={locs.filter((l) => l.gbpConnected).length}
          />
          <Link
            href={`/clients/${client.slug}/locations/new`}
            className={buttonClasses("outline")}
          >
            <Plus className="mr-2 h-4 w-4" /> Add location
          </Link>
        </div>
      </div>

      <LocationSwitcher
        clientSlug={client.slug}
        locations={locs.map((l) => ({ id: l.id, name: l.name }))}
        currentLocationId={selectedId}
      />

      {justAddedThis && (
        <div className="flex flex-col gap-3 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900 sm:flex-row sm:items-start">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
          <div className="flex-1">
            <div className="font-medium">{location.name} added.</div>
            <div className="mt-0.5 text-green-800">
              Run a scan below to populate the heat map.
              {!hasGbpConnected
                ? " Connect Google Business Profile to start syncing reviews."
                : " Reviews will sync from Google shortly."}
            </div>
          </div>
          {!hasGbpConnected && (
            <Link
              href={`/api/oauth/google/start?locationId=${location.id}`}
              className={buttonClasses("default", "sm")}
            >
              Connect Google Business Profile
            </Link>
          )}
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{location.name}</h2>
          <p className="text-sm text-muted-foreground">{location.address}</p>
          {rating !== null ? (
            <StarBar rating={rating} reviewCount={reviewCount} />
          ) : location.placeRating !== null ? (
            // Pre-OAuth fallback: show the public Google Places rating so
            // the user has *something* to anchor on before connecting GBP.
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <StarBar
                rating={Number(location.placeRating)}
                reviewCount={location.placeReviewCount ?? 0}
              />
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                from Google Places
              </span>
            </div>
          ) : hasGbpConnected ? (
            <p className="text-sm text-muted-foreground">
              Awaiting first review sync from Google.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No reviews yet. Connect Google Business Profile to start syncing.
            </p>
          )}
          {(location.placeWebsiteUri || location.placeGoogleMapsUri) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              {location.placeWebsiteUri && (
                <a
                  href={location.placeWebsiteUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  {location.placeWebsiteUri.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              )}
              {location.placeGoogleMapsUri && (
                <a
                  href={location.placeGoogleMapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:underline"
                >
                  View on Google Maps ↗
                </a>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <div className="flex items-center gap-2">
            {hasGbpConnected ? (
              <Badge variant="success">GBP connected</Badge>
            ) : (
              <Link
                href={`/api/oauth/google/start?locationId=${location.id}`}
                className={buttonClasses("outline")}
              >
                Connect Google Business Profile
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

      <SectionCard
        key={`heat-map-${location.id}`}
        icon={<Map className="h-4 w-4" />}
        title="Heat map"
        eyebrow="Local pack visibility"
        contentClassName="space-y-5 p-5"
      >
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
            latestScanId={latestScan?.id ?? null}
            recentScans={completedRecent.map((s) => ({
              id: s.id,
              completedAt: s.completedAt,
              startedAt: s.startedAt,
              keywordIds: scanKeywordMap.get(s.id) ?? [],
            }))}
          />
          <ScanManagementPanel
            variant="embedded"
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
      </SectionCard>

      <ReviewsTriageCard
        reviews={recentReviews}
        locationId={location.id}
        hasGbpConnected={hasGbpConnected}
      />

      <SerpRankingsCard data={serpRankings} clientSlug={client.slug} />
    </div>
  );
}
