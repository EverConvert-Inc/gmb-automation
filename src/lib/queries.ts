import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  clients,
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
};

export async function listClientsWithRollup(): Promise<ClientRow[]> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      status: clients.status,
      locationCount: sql<number>`count(distinct ${locations.id})::int`.as("loc_count"),
      ratingSum: sql<number>`coalesce(sum(${reviews.rating}), 0)::int`.as("rating_sum"),
      totalReviews: sql<number>`count(${reviews.id})::int`.as("total_reviews"),
      lastScanAt: sql<Date | null>`max(${scans.completedAt})`.as("last_scan_at"),
    })
    .from(clients)
    .leftJoin(locations, eq(locations.clientId, clients.id))
    .leftJoin(reviews, eq(reviews.locationId, locations.id))
    .leftJoin(scans, eq(scans.locationId, locations.id))
    .groupBy(clients.id)
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
    where: and(eq(scans.locationId, location.id), eq(scans.status, "completed")),
    orderBy: (cols, ops) => ops.desc(cols.completedAt),
  });

  const points = latestScan
    ? await db.query.scanPoints.findMany({
        where: eq(scanPoints.scanId, latestScan.id),
      })
    : [];

  const recentReviews = await db.query.reviews.findMany({
    where: eq(reviews.locationId, location.id),
    orderBy: desc(reviews.createdAt),
    limit: 10,
  });

  return { location, latestScan, points, recentReviews };
}

export async function listRecentScansForLocation(locationId: string, limit = 30) {
  return db.query.scans.findMany({
    where: eq(scans.locationId, locationId),
    orderBy: (cols, ops) => ops.desc(cols.startedAt),
    limit,
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
