import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { DashboardNav } from "@/components/dashboard-nav";
import { HeatMapClient } from "@/components/heat-map-client";
import { HeroSnapshotCard } from "@/components/hero-snapshot-card";
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
import { computeScanMetrics } from "@/lib/metrics";
import { Map, MapPin, Plus } from "lucide-react";

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
        <header className="flex items-end justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Client
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {client.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              No locations yet
            </p>
          </div>
        </header>
        <Card className="surface-brand-tint">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="rounded-full bg-brand/10 p-4 ring-1 ring-brand/20">
              <MapPin className="h-7 w-7 text-brand" />
            </div>
            <div className="max-w-md space-y-1.5">
              <p className="text-sm font-semibold">
                Let&rsquo;s set up your first location
              </p>
              <p className="text-xs text-muted-foreground">
                Search Google Places to attach a real business listing, then
                we&rsquo;ll fill in the rest — address, coordinates, and
                public Google rating — automatically.
              </p>
            </div>
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

  // Pre-compute the headline KPIs for the hero snapshot. ARP/SoLV come from
  // the latest scan's points (filtered to the primary keyword if there is
  // one — otherwise all of them) so the hero stays in sync with the heat
  // map's default keyword view.
  const primaryKeywordId =
    allKeywords.find((k) => k.isPrimary)?.id ?? allKeywords[0]?.id ?? null;
  const heroScanPoints = primaryKeywordId
    ? heatMapPoints.filter((p) => p.keywordId === primaryKeywordId)
    : heatMapPoints;
  const heroMetrics = computeScanMetrics(
    heroScanPoints.map((p) => ({ rank: p.rank ?? null })),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Client
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {client.name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <StarBar rating={weightedRating} reviewCount={totalReviews} />
            <span className="text-muted-foreground/50">·</span>
            <span>
              {locs.length} location{locs.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
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
      </header>

      <LocationSwitcher
        clientSlug={client.slug}
        locations={locs.map((l) => ({ id: l.id, name: l.name }))}
        currentLocationId={selectedId}
      />

      {justAddedThis && (
        <Banner
          tone="success"
          title={`${location.name} added.`}
          action={
            !hasGbpConnected && (
              <Link
                href={`/api/oauth/google/start?locationId=${location.id}`}
                className={buttonClasses("default", "sm")}
              >
                Connect Google Business Profile
              </Link>
            )
          }
        >
          Run a scan below to populate the heat map.
          {!hasGbpConnected
            ? " Connect Google Business Profile to start syncing reviews."
            : " Reviews will sync from Google shortly."}
        </Banner>
      )}

      {gbpLink === "linked" && (
        <Banner tone="success" title="Google Business Profile connected.">
          Started the first review sync. Reviews will appear below within a few
          seconds — refresh if you don&rsquo;t see them yet.
        </Banner>
      )}
      {gbpLink === "no_match" && (
        <Banner
          tone="warning"
          title="Google Business Profile connected, but no matching listing found."
        >
          The Google account you connected doesn&rsquo;t manage a business with
          this Place ID. Sign in with the account that owns this listing, or
          use &ldquo;Sync reviews&rdquo; below once you&rsquo;ve granted
          access.
        </Banner>
      )}
      {gbpLink === "failed" && (
        <Banner
          tone="warning"
          title="Connected, but couldn&rsquo;t auto-link this listing."
        >
          We saved the token but the GBP discovery call failed. Click
          &ldquo;Sync reviews&rdquo; below to retry, or check the server logs.
        </Banner>
      )}

      <HeroSnapshotCard
        locationId={location.id}
        name={location.name}
        address={location.address}
        rating={rating}
        reviewCount={reviewCount}
        placeRating={
          location.placeRating !== null ? Number(location.placeRating) : null
        }
        placeReviewCount={location.placeReviewCount}
        placeWebsiteUri={location.placeWebsiteUri}
        placeGoogleMapsUri={location.placeGoogleMapsUri}
        hasGbpConnected={hasGbpConnected}
        lastPolledAt={location.lastPolledAt}
        nextPollAfter={location.nextPollAfter}
        lastPollError={location.lastPollError}
        lastPollErrorAt={location.lastPollErrorAt}
        consecutivePollFailures={location.consecutivePollFailures}
        kpis={{
          daysSinceLastReview: reviewInsights.daysSinceLastReview,
          arp: heroMetrics.arp,
          solv: heroMetrics.totalPoints ? heroMetrics.solv : null,
          lastScanAt: latestScan?.completedAt ?? null,
        }}
      />

      <DashboardNav
        items={[
          { id: "review-velocity", label: "Reviews velocity" },
          { id: "heat-map", label: "Heat map" },
          { id: "reviews", label: "Reviews" },
          { id: "search-rankings", label: "Search rankings" },
        ]}
      />

      <div id="review-velocity" className="scroll-mt-24">
        <ReviewInsightsCard data={reviewInsights} />
      </div>

      <SectionCard
        key={`heat-map-${location.id}`}
        id="heat-map"
        icon={<Map className="h-4 w-4" />}
        title="Heat map"
        eyebrow="Local pack visibility"
        contentClassName="space-y-5 p-5"
        className="scroll-mt-24"
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

      <div className="scroll-mt-24">
        <ReviewsTriageCard
          reviews={recentReviews}
          locationId={location.id}
          hasGbpConnected={hasGbpConnected}
        />
      </div>

      <div id="search-rankings" className="scroll-mt-24">
        <SerpRankingsCard data={serpRankings} clientSlug={client.slug} />
      </div>
    </div>
  );
}
