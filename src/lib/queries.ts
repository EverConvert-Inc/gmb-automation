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

export type Velocity = { this30: number; prior30: number };

function velocityCutoffs() {
  const now = Date.now();
  return {
    cutoff30: new Date(now - 30 * 86_400_000),
    cutoff60: new Date(now - 60 * 86_400_000),
  };
}

export type ClientRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  locationCount: number;
  weightedRating: number | null;
  totalReviews: number;
  velocity: Velocity;
  lastScanAt: Date | null;
};

export async function listClientsWithRollup(): Promise<ClientRow[]> {
  const baseClients = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      status: clients.status,
    })
    .from(clients)
    .orderBy(clients.name);

  const reviewAgg = await db
    .select({
      clientId: locations.clientId,
      locationCount: sql<number>`count(distinct ${locations.id})::int`.as("loc_count"),
      ratingSum: sql<number>`coalesce(sum(${reviews.rating}), 0)::int`.as("rating_sum"),
      totalReviews: sql<number>`count(${reviews.id})::int`.as("total_reviews"),
    })
    .from(locations)
    .leftJoin(reviews, eq(reviews.locationId, locations.id))
    .groupBy(locations.clientId);

  const { cutoff30, cutoff60 } = velocityCutoffs();
  const velocityAgg = await db
    .select({
      clientId: locations.clientId,
      this30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff30})::int`.as("this_30"),
      prior30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff60} and ${reviews.createdAt} < ${cutoff30})::int`.as("prior_30"),
    })
    .from(locations)
    .leftJoin(reviews, eq(reviews.locationId, locations.id))
    .groupBy(locations.clientId);

  const scanAgg = await db
    .select({
      clientId: locations.clientId,
      lastScanAt: sql<Date | null>`max(${scans.completedAt})`.as("last_scan_at"),
    })
    .from(locations)
    .leftJoin(scans, eq(scans.locationId, locations.id))
    .groupBy(locations.clientId);

  const reviewMap = new Map(reviewAgg.map((r) => [r.clientId, r]));
  const velocityMap = new Map(velocityAgg.map((v) => [v.clientId, v]));
  const scanMap = new Map(scanAgg.map((s) => [s.clientId, s]));

  return baseClients.map((c) => {
    const r = reviewMap.get(c.id);
    const v = velocityMap.get(c.id);
    const s = scanMap.get(c.id);
    const totalReviews = r?.totalReviews ?? 0;
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      locationCount: r?.locationCount ?? 0,
      weightedRating: totalReviews > 0 ? (r?.ratingSum ?? 0) / totalReviews : null,
      totalReviews,
      velocity: { this30: v?.this30 ?? 0, prior30: v?.prior30 ?? 0 },
      lastScanAt: s?.lastScanAt ?? null,
    };
  });
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
  velocity: Velocity;
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

  const { cutoff30, cutoff60 } = velocityCutoffs();

  return Promise.all(
    locs.map(async (l) => {
      const reviewAgg = await db
        .select({
          rating: sql<number | null>`avg(${reviews.rating})`,
          count: sql<number>`count(${reviews.id})::int`,
          last: sql<Date | null>`max(${reviews.createdAt})`,
          this30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff30})::int`,
          prior30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff60} and ${reviews.createdAt} < ${cutoff30})::int`,
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
        velocity: {
          this30: reviewAgg[0]?.this30 ?? 0,
          prior30: reviewAgg[0]?.prior30 ?? 0,
        },
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

export async function getLocationReviewStats(locationId: string): Promise<{
  this30: number;
  prior30: number;
  this90: number;
  daysSinceLastReview: number | null;
}> {
  const { cutoff30, cutoff60 } = velocityCutoffs();
  const cutoff90 = new Date(Date.now() - 90 * 86_400_000);
  const [row] = await db
    .select({
      this30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff30})::int`,
      prior30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff60} and ${reviews.createdAt} < ${cutoff30})::int`,
      this90: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff90})::int`,
      lastAt: sql<Date | null>`max(${reviews.createdAt})`,
    })
    .from(reviews)
    .where(eq(reviews.locationId, locationId));
  const lastAt = row?.lastAt ?? null;
  const daysSinceLastReview = lastAt
    ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000)
    : null;
  return {
    this30: row?.this30 ?? 0,
    prior30: row?.prior30 ?? 0,
    this90: row?.this90 ?? 0,
    daysSinceLastReview,
  };
}

export async function getLocationWeeklyReviews(
  locationId: string,
  weeks = 12,
): Promise<Array<{ weekStart: string; count: number }>> {
  const cutoff = new Date(Date.now() - weeks * 7 * 86_400_000);
  const rows = await db
    .select({
      weekStart: sql<string>`to_char(date_trunc('week', ${reviews.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(and(eq(reviews.locationId, locationId), gte(reviews.createdAt, cutoff)))
    .groupBy(sql`date_trunc('week', ${reviews.createdAt})`)
    .orderBy(sql`date_trunc('week', ${reviews.createdAt})`);

  const byKey = new Map(rows.map((r) => [r.weekStart, r.count]));
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dow = todayUtc.getUTCDay();
  const daysToMonday = (dow + 6) % 7;
  const currentMonday = new Date(todayUtc);
  currentMonday.setUTCDate(todayUtc.getUTCDate() - daysToMonday);

  const out: Array<{ weekStart: string; count: number }> = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(currentMonday);
    d.setUTCDate(currentMonday.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    out.push({ weekStart: key, count: byKey.get(key) ?? 0 });
  }
  return out;
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

  return { location, latestScan, points, completedPoints, recentReviews };
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
