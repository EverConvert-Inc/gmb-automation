import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  clients,
  gridConfigs,
  locationDailyMetrics,
  locations,
  reviews,
  scanPoints,
  scans,
} from "./db/schema";

export type ClientRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  locationCount: number;
  weightedRating: number | null;
  totalReviews: number;
  lastScanAt: Date | null;
  lastScanLocationName: string | null;
};

export async function listClientsWithRollup(): Promise<ClientRow[]> {
  // Use correlated subqueries so reviews and scans don't multiply each other
  // via a Cartesian join (which inflated `totalReviews` by the per-location
  // scan count when both were joined-and-grouped together).
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      status: clients.status,
      locationCount: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${locations} l
        WHERE l.client_id = ${clients.id}
      )`.as("loc_count"),
      ratingSum: sql<number>`(
        SELECT COALESCE(SUM(r.rating), 0)::int
        FROM ${reviews} r
        JOIN ${locations} l ON l.id = r.location_id
        WHERE l.client_id = ${clients.id}
      )`.as("rating_sum"),
      totalReviews: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${reviews} r
        JOIN ${locations} l ON l.id = r.location_id
        WHERE l.client_id = ${clients.id}
      )`.as("total_reviews"),
      lastScanAt: sql<Date | null>`(
        SELECT MAX(s.completed_at)
        FROM ${scans} s
        JOIN ${locations} l ON l.id = s.location_id
        WHERE l.client_id = ${clients.id}
      )`.as("last_scan_at"),
      lastScanLocationName: sql<string | null>`(
        SELECT l.name
        FROM ${scans} s
        JOIN ${locations} l ON l.id = s.location_id
        WHERE l.client_id = ${clients.id} AND s.completed_at IS NOT NULL
        ORDER BY s.completed_at DESC
        LIMIT 1
      )`.as("last_scan_location_name"),
    })
    .from(clients)
    .orderBy(clients.name);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    locationCount: r.locationCount ?? 0,
    weightedRating: r.totalReviews > 0 ? r.ratingSum / r.totalReviews : null,
    totalReviews: r.totalReviews ?? 0,
    lastScanAt: r.lastScanAt ?? null,
    lastScanLocationName: r.lastScanLocationName ?? null,
  }));
}

export type LocationCardRow = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewCount: number;
  daysSinceLastReview: number | null;
  latestScan: { id: string; completedAt: Date | null; arp: number | null; solv: number | null } | null;
};

export async function getClientBySlug(slug: string) {
  return db.query.clients.findFirst({ where: eq(clients.slug, slug) });
}

export async function listLocationsForClient(clientId: string): Promise<LocationCardRow[]> {
  const locs = await db.query.locations.findMany({
    where: eq(locations.clientId, clientId),
    orderBy: (cols, ops) => ops.asc(cols.name),
  });

  return Promise.all(
    locs.map(async (l) => {
      const reviewAgg = await db
        .select({
          rating: sql<number | null>`avg(${reviews.rating})`,
          count: sql<number>`count(${reviews.id})::int`,
          last: sql<Date | null>`max(${reviews.createdAt})`,
        })
        .from(reviews)
        .where(eq(reviews.locationId, l.id));

      const lastReview = reviewAgg[0]?.last ?? null;
      const daysSinceLastReview = lastReview
        ? Math.floor((Date.now() - new Date(lastReview).getTime()) / 86_400_000)
        : null;

      const latestScan = await db.query.scans.findFirst({
        where: and(eq(scans.locationId, l.id), eq(scans.status, "completed")),
        orderBy: (cols, ops) => ops.desc(cols.completedAt),
      });

      let arp: number | null = null;
      let solv: number | null = null;
      if (latestScan) {
        const points = await db
          .select({
            rank: scanPoints.rank,
          })
          .from(scanPoints)
          .where(eq(scanPoints.scanId, latestScan.id));
        const ranked = points.filter((p) => p.rank !== null && (p.rank as number) > 0);
        const top3 = ranked.filter((p) => (p.rank as number) <= 3).length;
        arp = ranked.length
          ? ranked.reduce((a, p) => a + (p.rank as number), 0) / ranked.length
          : null;
        solv = points.length ? (top3 / points.length) * 100 : null;
      }

      return {
        id: l.id,
        name: l.name,
        address: l.address,
        lat: Number(l.lat),
        lng: Number(l.lng),
        rating: reviewAgg[0]?.rating ? Number(reviewAgg[0].rating) : null,
        reviewCount: reviewAgg[0]?.count ?? 0,
        daysSinceLastReview,
        latestScan: latestScan
          ? {
              id: latestScan.id,
              completedAt: latestScan.completedAt,
              arp,
              solv,
            }
          : null,
      };
    }),
  );
}

export async function getLocationWithLatestScan(locationId: string) {
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) return null;

  const latestScan = await db.query.scans.findFirst({
    where: eq(scans.locationId, location.id),
    orderBy: (cols, ops) => ops.desc(cols.startedAt),
  });

  const points = latestScan
    ? await db.query.scanPoints.findMany({
        where: eq(scanPoints.scanId, latestScan.id),
      })
    : [];

  const completedPoints = points.filter(
    (p) => p.status === "completed" || p.status === "errored",
  ).length;

  const recentReviews = await db.query.reviews.findMany({
    where: eq(reviews.locationId, location.id),
    orderBy: desc(reviews.createdAt),
    limit: 10,
  });

  const reviewAgg = await db
    .select({
      rating: sql<number | null>`avg(${reviews.rating})`,
      count: sql<number>`count(${reviews.id})::int`,
    })
    .from(reviews)
    .where(eq(reviews.locationId, location.id));
  const rating =
    reviewAgg[0]?.rating !== null && reviewAgg[0]?.rating !== undefined
      ? Number(reviewAgg[0].rating)
      : null;
  const reviewCount = reviewAgg[0]?.count ?? 0;

  return {
    location,
    latestScan,
    points,
    completedPoints,
    recentReviews,
    rating,
    reviewCount,
  };
}

export async function listRecentScansForLocation(locationId: string, limit = 30) {
  return db.query.scans.findMany({
    where: eq(scans.locationId, locationId),
    orderBy: (cols, ops) => ops.desc(cols.startedAt),
    limit,
  });
}

export type ActiveScanInfo = {
  id: string;
  status: string;
  totalPoints: number;
  completedPoints: number;
};

export async function getActiveScanForLocation(
  locationId: string,
): Promise<ActiveScanInfo | null> {
  const scan = await db.query.scans.findFirst({
    where: and(
      eq(scans.locationId, locationId),
      inArray(scans.status, ["queued", "running"]),
    ),
    orderBy: (cols, ops) => ops.desc(cols.startedAt),
  });
  if (!scan) return null;

  const completed = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scanPoints)
    .where(
      and(
        eq(scanPoints.scanId, scan.id),
        inArray(scanPoints.status, ["completed", "errored"]),
      ),
    );

  return {
    id: scan.id,
    status: scan.status,
    totalPoints: scan.totalPoints,
    completedPoints: completed[0]?.count ?? 0,
  };
}

export type ScanReplayConfig = {
  keywordIds: string[];
  gridConfigId: string | null;
};

export async function getScanReplayConfig(
  scanId: string,
): Promise<ScanReplayConfig | null> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { id: true, gridConfigId: true, locationId: true },
  });
  if (!scan) return null;

  const distinctKeywords = await db
    .selectDistinct({ keywordId: scanPoints.keywordId })
    .from(scanPoints)
    .where(eq(scanPoints.scanId, scanId));

  let gridConfigId: string | null = null;
  if (scan.gridConfigId) {
    const config = await db.query.gridConfigs.findFirst({
      where: eq(gridConfigs.id, scan.gridConfigId),
      columns: { id: true },
    });
    if (config) gridConfigId = config.id;
  }

  return {
    keywordIds: distinctKeywords.map((row) => row.keywordId),
    gridConfigId,
  };
}

export async function listKeywordsForLocation(locationId: string) {
  return db.query.keywords.findMany({
    where: (cols, ops) => ops.eq(cols.locationId, locationId),
    orderBy: (cols, ops) => [ops.desc(cols.isPrimary), ops.asc(cols.createdAt)],
  });
}

export async function listGridConfigsForLocation(locationId: string) {
  return db.query.gridConfigs.findMany({
    where: (cols, ops) => ops.eq(cols.locationId, locationId),
    orderBy: (cols, ops) => [ops.desc(cols.isDefault), ops.asc(cols.createdAt)],
  });
}

export async function listLocationsDueForPolling(now = new Date()) {
  const dailyCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return db.query.locations.findMany({
    where: and(
      eq(locations.status, "active"),
      sql`(${locations.lastPolledAt} IS NULL OR ${locations.lastPolledAt} < ${dailyCutoff.toISOString()})`,
    ),
  });
}

export async function locationDailyMetricsRange(locationId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return db.query.locationDailyMetrics.findMany({
    where: and(
      eq(locationDailyMetrics.locationId, locationId),
      gte(locationDailyMetrics.metricDate, cutoff.toISOString().slice(0, 10)),
    ),
    orderBy: (cols, ops) => ops.asc(cols.metricDate),
  });
}
