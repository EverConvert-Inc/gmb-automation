import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  clients,
  gridConfigs,
  locationDailyMetrics,
  locationPerformanceDaily,
  locations,
  reviews,
  scanPoints,
  scans,
  serpRankings,
  trackedKeywords,
} from "./db/schema";
import { detectCity, stripTrailingSlash } from "./dataforseo";
import { PERFORMANCE_METRICS, type PerformanceMetric } from "./gbp";

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
  lastScanLocationName: string | null;
};

export async function listClientsWithRollup(): Promise<ClientRow[]> {
  // Multiple small aggregates instead of one big join: a multi-join with
  // reviews AND scans was producing a Cartesian product that inflated
  // totalReviews, and a single-pass correlated-subquery rewrite tripped
  // Postgres' "column reference id is ambiguous" check inside the nested
  // SELECTs. Splitting these out is safe and cheap.
  const baseClients = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      status: clients.status,
    })
    .from(clients)
    .orderBy(clients.name);
  if (baseClients.length === 0) return [];

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
  const cutoff30Iso = cutoff30.toISOString();
  const cutoff60Iso = cutoff60.toISOString();
  const velocityAgg = await db
    .select({
      clientId: locations.clientId,
      this30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff30Iso})::int`.as("this_30"),
      prior30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff60Iso} and ${reviews.createdAt} < ${cutoff30Iso})::int`.as("prior_30"),
    })
    .from(locations)
    .leftJoin(reviews, eq(reviews.locationId, locations.id))
    .groupBy(locations.clientId);

  // Most-recent completed scan per client, with the location's name. Fetch
  // raw + dedupe client-side because Drizzle's typed builder doesn't have
  // first-class DISTINCT ON.
  const scanRows = await db
    .select({
      clientId: locations.clientId,
      locationName: locations.name,
      completedAt: scans.completedAt,
    })
    .from(scans)
    .innerJoin(locations, eq(locations.id, scans.locationId))
    .where(sql`${scans.completedAt} IS NOT NULL`)
    .orderBy(desc(scans.completedAt));

  const reviewMap = new Map(reviewAgg.map((r) => [r.clientId, r]));
  const velocityMap = new Map(velocityAgg.map((v) => [v.clientId, v]));
  const lastScanMap = new Map<string, { completedAt: Date; locationName: string }>();
  for (const s of scanRows) {
    if (!s.completedAt) continue;
    if (!lastScanMap.has(s.clientId)) {
      lastScanMap.set(s.clientId, {
        completedAt: s.completedAt,
        locationName: s.locationName,
      });
    }
  }

  return baseClients.map((c) => {
    const r = reviewMap.get(c.id);
    const v = velocityMap.get(c.id);
    const lastScan = lastScanMap.get(c.id);
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
      lastScanAt: lastScan?.completedAt ?? null,
      lastScanLocationName: lastScan?.locationName ?? null,
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
  const cutoff30Iso = cutoff30.toISOString();
  const cutoff60Iso = cutoff60.toISOString();

  return Promise.all(
    locs.map(async (l) => {
      const reviewAgg = await db
        .select({
          rating: sql<number | null>`avg(${reviews.rating})`,
          count: sql<number>`count(${reviews.id})::int`,
          last: sql<Date | null>`max(${reviews.createdAt})`,
          this30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff30Iso})::int`,
          prior30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff60Iso} and ${reviews.createdAt} < ${cutoff30Iso})::int`,
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
  const cutoff30Iso = cutoff30.toISOString();
  const cutoff60Iso = cutoff60.toISOString();
  const cutoff90Iso = cutoff90.toISOString();
  const [row] = await db
    .select({
      this30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff30Iso})::int`,
      prior30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff60Iso} and ${reviews.createdAt} < ${cutoff30Iso})::int`,
      this90: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${cutoff90Iso})::int`,
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
  // A location is due when:
  //   - it's an active row
  //   - its pollFrequency isn't "manual" (those are sync-only)
  //   - its nextPollAfter is either unset (never polled) or has elapsed
  // nextPollAfter is written by pollReviewsForLocation on both success
  // (now + frequency interval) and failure (now + exponential backoff),
  // so this gate handles both "wait until next scheduled sync" and
  // "back off after errors" without separate logic here.
  return db.query.locations.findMany({
    where: and(
      eq(locations.status, "active"),
      sql`${locations.pollFrequency} <> 'manual'`,
      sql`(${locations.nextPollAfter} IS NULL OR ${locations.nextPollAfter} <= ${now.toISOString()})`,
    ),
  });
}

export type LocationSnapshot = {
  id: string;
  clientId: string;
  name: string;
  address: string;
  isGbpConnected: boolean;
  rating: number | null;
  reviewCount: number;
  lastReviewAt: Date | null;
  daysSinceLastReview: number | null;
  last30: number;
  prior30: number;
  last90: number;
  prior90: number;
  latestScan: {
    id: string;
    completedAt: Date | null;
    arp: number | null;
    solv: number;
    coverage: number;
    totalPoints: number;
    rankedPoints: number;
    arpDelta: number | null;
    solvDelta: number | null;
    coverageDelta: number | null;
  } | null;
};

// Bulk-fetches the data needed to render a "quick view" of every location
// under the given clients on /clients: review aggregates with windowed
// counts, and the latest two completed scans (for ARP/SoLV/Coverage with a
// delta vs the previous scan). Returns a map keyed by clientId.
//
// At small scale this is fine (4 queries regardless of N). If we ever scale
// to thousands of locations we'll want to push the windowing into SQL.
export async function listLocationSnapshots(
  clientIds: string[],
): Promise<Map<string, LocationSnapshot[]>> {
  if (clientIds.length === 0) return new Map();

  const locs = await db.query.locations.findMany({
    where: inArray(locations.clientId, clientIds),
    orderBy: (cols, ops) => [ops.asc(cols.name)],
  });
  if (locs.length === 0) return new Map();

  const locationIds = locs.map((l) => l.id);
  const now = Date.now();
  const d30 = new Date(now - 30 * 86_400_000);
  const d60 = new Date(now - 60 * 86_400_000);
  const d90 = new Date(now - 90 * 86_400_000);
  const d180 = new Date(now - 180 * 86_400_000);

  const reviewAgg = await db
    .select({
      locationId: reviews.locationId,
      count: sql<number>`count(${reviews.id})::int`.as("rev_count"),
      avgRating: sql<number | null>`avg(${reviews.rating})`,
      lastAt: sql<Date | null>`max(${reviews.createdAt})`,
      last30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${d30.toISOString()})::int`,
      prior30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${d60.toISOString()} and ${reviews.createdAt} < ${d30.toISOString()})::int`,
      last90: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${d90.toISOString()})::int`,
      prior90: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${d180.toISOString()} and ${reviews.createdAt} < ${d90.toISOString()})::int`,
    })
    .from(reviews)
    .where(inArray(reviews.locationId, locationIds))
    .groupBy(reviews.locationId);

  const reviewMap = new Map(reviewAgg.map((r) => [r.locationId, r]));

  const completedScans = await db
    .select({
      id: scans.id,
      locationId: scans.locationId,
      completedAt: scans.completedAt,
      totalPoints: scans.totalPoints,
    })
    .from(scans)
    .where(
      and(
        inArray(scans.locationId, locationIds),
        eq(scans.status, "completed"),
      ),
    )
    .orderBy(desc(scans.completedAt));

  // Take the two most recent completed scans per location.
  const scansByLoc = new Map<
    string,
    Array<{ id: string; completedAt: Date | null; totalPoints: number }>
  >();
  for (const s of completedScans) {
    const list = scansByLoc.get(s.locationId);
    if (list) {
      if (list.length < 2) list.push(s);
    } else {
      scansByLoc.set(s.locationId, [s]);
    }
  }

  const targetScanIds = Array.from(scansByLoc.values()).flatMap((ss) =>
    ss.map((s) => s.id),
  );
  const pointsByScan = new Map<string, Array<{ rank: number | null }>>();
  if (targetScanIds.length > 0) {
    const allPoints = await db
      .select({ scanId: scanPoints.scanId, rank: scanPoints.rank })
      .from(scanPoints)
      .where(inArray(scanPoints.scanId, targetScanIds));
    for (const p of allPoints) {
      const list = pointsByScan.get(p.scanId);
      if (list) list.push({ rank: p.rank });
      else pointsByScan.set(p.scanId, [{ rank: p.rank }]);
    }
  }

  function metricsForScan(scanId: string) {
    const points = pointsByScan.get(scanId) ?? [];
    const total = points.length;
    const ranked = points.filter((p) => p.rank !== null && p.rank > 0);
    const top3 = ranked.filter((p) => (p.rank as number) <= 3).length;
    const arp = ranked.length
      ? ranked.reduce((acc, p) => acc + (p.rank as number), 0) / ranked.length
      : null;
    return {
      arp,
      solv: total > 0 ? (top3 / total) * 100 : 0,
      coverage: total > 0 ? (ranked.length / total) * 100 : 0,
      totalPoints: total,
      rankedPoints: ranked.length,
    };
  }

  const out = new Map<string, LocationSnapshot[]>();
  for (const l of locs) {
    const r = reviewMap.get(l.id);
    const lastAt = r?.lastAt ?? null;
    const daysSinceLast = lastAt
      ? Math.floor((now - new Date(lastAt).getTime()) / 86_400_000)
      : null;

    const myScans = scansByLoc.get(l.id) ?? [];
    let latestScan: LocationSnapshot["latestScan"] = null;
    if (myScans.length > 0) {
      const newest = myScans[0];
      const prior = myScans[1] ?? null;
      const nm = metricsForScan(newest.id);
      const pm = prior ? metricsForScan(prior.id) : null;
      latestScan = {
        id: newest.id,
        completedAt: newest.completedAt,
        arp: nm.arp,
        solv: nm.solv,
        coverage: nm.coverage,
        totalPoints: nm.totalPoints,
        rankedPoints: nm.rankedPoints,
        arpDelta:
          nm.arp !== null && pm && pm.arp !== null ? nm.arp - pm.arp : null,
        solvDelta: pm ? nm.solv - pm.solv : null,
        coverageDelta: pm ? nm.coverage - pm.coverage : null,
      };
    }

    const snap: LocationSnapshot = {
      id: l.id,
      clientId: l.clientId,
      name: l.name,
      address: l.address,
      isGbpConnected: l.gbpOauthTokenId !== null,
      rating:
        r?.avgRating !== null && r?.avgRating !== undefined
          ? Number(r.avgRating)
          : null,
      reviewCount: r?.count ?? 0,
      lastReviewAt: lastAt,
      daysSinceLastReview: daysSinceLast,
      last30: r?.last30 ?? 0,
      prior30: r?.prior30 ?? 0,
      last90: r?.last90 ?? 0,
      prior90: r?.prior90 ?? 0,
      latestScan,
    };
    const arr = out.get(l.clientId);
    if (arr) arr.push(snap);
    else out.set(l.clientId, [snap]);
  }
  return out;
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

export type ReviewInsights = {
  totalReviews: number;
  averageRating: number | null;
  lastReviewAt: Date | null;
  daysSinceLastReview: number | null;
  last30: number;
  prior30: number;
  last60: number;
  prior60: number;
  last90: number;
  prior90: number;
  monthlyBuckets: Array<{ monthStart: string; count: number }>;
};

export async function getReviewInsights(locationId: string): Promise<ReviewInsights> {
  const now = Date.now();
  const d30 = new Date(now - 30 * 86_400_000);
  const d60 = new Date(now - 60 * 86_400_000);
  const d90 = new Date(now - 90 * 86_400_000);
  const d365 = new Date(now - 365 * 86_400_000);

  // Single pass: aggregate + windowed counts. Postgres FILTER is the clean
  // way to do conditional counts.
  const aggRows = await db
    .select({
      total: sql<number>`count(${reviews.id})::int`,
      avgRating: sql<number | null>`avg(${reviews.rating})`,
      lastAt: sql<Date | null>`max(${reviews.createdAt})`,
      last30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${d30.toISOString()})::int`,
      prior30: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${d60.toISOString()} and ${reviews.createdAt} < ${d30.toISOString()})::int`,
      last60: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${d60.toISOString()})::int`,
      prior60: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${new Date(now - 120 * 86_400_000).toISOString()} and ${reviews.createdAt} < ${d60.toISOString()})::int`,
      last90: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${d90.toISOString()})::int`,
      prior90: sql<number>`count(*) filter (where ${reviews.createdAt} >= ${new Date(now - 180 * 86_400_000).toISOString()} and ${reviews.createdAt} < ${d90.toISOString()})::int`,
    })
    .from(reviews)
    .where(eq(reviews.locationId, locationId));

  const agg = aggRows[0];
  const monthly = await db
    .select({
      monthStart: sql<string>`to_char(date_trunc('month', ${reviews.createdAt}), 'YYYY-MM-DD')`.as("month_start"),
      count: sql<number>`count(*)::int`.as("review_count"),
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.locationId, locationId),
        gte(reviews.createdAt, d365),
      ),
    )
    .groupBy(sql`date_trunc('month', ${reviews.createdAt})`)
    .orderBy(sql`date_trunc('month', ${reviews.createdAt})`);

  // Backfill missing months with zero so the bar chart spans 12 months.
  const monthlyBuckets: Array<{ monthStart: string; count: number }> = [];
  const cursor = new Date(d365);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  const today = new Date();
  const byMonth = new Map(monthly.map((m) => [m.monthStart, m.count]));
  while (cursor <= today) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
    monthlyBuckets.push({ monthStart: key, count: byMonth.get(key) ?? 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const lastReviewAt = agg?.lastAt ?? null;
  return {
    totalReviews: agg?.total ?? 0,
    averageRating: agg?.avgRating !== null && agg?.avgRating !== undefined ? Number(agg.avgRating) : null,
    lastReviewAt,
    daysSinceLastReview: lastReviewAt
      ? Math.floor((now - new Date(lastReviewAt).getTime()) / 86_400_000)
      : null,
    last30: agg?.last30 ?? 0,
    prior30: agg?.prior30 ?? 0,
    last60: agg?.last60 ?? 0,
    prior60: agg?.prior60 ?? 0,
    last90: agg?.last90 ?? 0,
    prior90: agg?.prior90 ?? 0,
    monthlyBuckets,
  };
}

export type ScanComparison = {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  triggeredBy: string;
  totalPoints: number;
  rankedPoints: number;
  arp: number | null;
  solv: number;
  coverage: number;
};

export async function getRecentScanComparisons(
  locationId: string,
  limit = 6,
): Promise<ScanComparison[]> {
  const completed = await db.query.scans.findMany({
    where: and(eq(scans.locationId, locationId), eq(scans.status, "completed")),
    orderBy: (cols, ops) => ops.desc(cols.completedAt),
    limit,
  });
  if (completed.length === 0) return [];

  const scanIds = completed.map((s) => s.id);
  const allPoints = await db
    .select({
      scanId: scanPoints.scanId,
      rank: scanPoints.rank,
    })
    .from(scanPoints)
    .where(inArray(scanPoints.scanId, scanIds));

  const grouped = new Map<string, Array<{ rank: number | null }>>();
  for (const p of allPoints) {
    const list = grouped.get(p.scanId);
    if (list) list.push({ rank: p.rank });
    else grouped.set(p.scanId, [{ rank: p.rank }]);
  }

  // Reuse the same arithmetic as computeScanMetrics ("ignore_null" strategy)
  // without importing it here to keep this file framework-agnostic.
  return completed.map((s) => {
    const points = grouped.get(s.id) ?? [];
    const total = points.length;
    const ranked = points.filter((p) => p.rank !== null && p.rank > 0);
    const top3 = ranked.filter((p) => (p.rank as number) <= 3).length;
    const arp = ranked.length
      ? ranked.reduce((acc, p) => acc + (p.rank as number), 0) / ranked.length
      : null;
    return {
      id: s.id,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      triggeredBy: s.triggeredBy,
      totalPoints: total,
      rankedPoints: ranked.length,
      arp,
      solv: total > 0 ? (top3 / total) * 100 : 0,
      coverage: total > 0 ? (ranked.length / total) * 100 : 0,
    };
  });
}

export type PerformanceTile = {
  metric: PerformanceMetric;
  last30: number;
  prior30: number;
  daily: Array<{ date: string; value: number }>;
};

export type PerformanceInsights = {
  tiles: PerformanceTile[];
  lastDataDate: string | null;
  earliestDataDate: string | null;
};

// Returns per-metric counts for the rolling last-30-day window vs the prior
// 30 days, plus the raw daily series for the last 60 days (so the card can
// render sparklines without an extra query). Sums in JS so a single SELECT
// returns everything needed.
export async function getPerformanceInsights(
  locationId: string,
): Promise<PerformanceInsights> {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const d30Str = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const d60Str = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);

  // Defensive: if the location_performance_daily table or its columns don't
  // exist yet (typically because the 0002 migration hasn't been run on this
  // environment) we return an empty result instead of crashing the dashboard
  // render. The PerformanceCard already renders an "awaiting data" empty
  // state for that shape.
  let rows: Array<{ metric: string; date: string; value: number }> = [];
  try {
    rows = await db
      .select({
        metric: locationPerformanceDaily.metric,
        date: locationPerformanceDaily.metricDate,
        value: locationPerformanceDaily.value,
      })
      .from(locationPerformanceDaily)
      .where(
        and(
          eq(locationPerformanceDaily.locationId, locationId),
          gte(locationPerformanceDaily.metricDate, d60Str),
        ),
      );
  } catch (err) {
    console.error(
      "[getPerformanceInsights] failed; treating as no data. Did you run pending DB migrations?",
      err,
    );
    return {
      tiles: PERFORMANCE_METRICS.map((metric) => ({
        metric,
        last30: 0,
        prior30: 0,
        daily: [],
      })),
      lastDataDate: null,
      earliestDataDate: null,
    };
  }

  const byMetric = new Map<string, Array<{ date: string; value: number }>>();
  let lastDataDate: string | null = null;
  for (const r of rows) {
    const list = byMetric.get(r.metric);
    if (list) list.push({ date: r.date, value: r.value });
    else byMetric.set(r.metric, [{ date: r.date, value: r.value }]);
    if (lastDataDate === null || r.date > lastDataDate) lastDataDate = r.date;
  }

  let earliestDataDate: string | null = null;
  try {
    const earliestRow = await db
      .select({
        min: sql<string | null>`min(${locationPerformanceDaily.metricDate})`,
      })
      .from(locationPerformanceDaily)
      .where(eq(locationPerformanceDaily.locationId, locationId));
    earliestDataDate = earliestRow[0]?.min ?? null;
  } catch {
    // already logged above; keep null
  }

  const tiles: PerformanceTile[] = PERFORMANCE_METRICS.map((metric) => {
    const series = (byMetric.get(metric) ?? []).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    let last30 = 0;
    let prior30 = 0;
    for (const d of series) {
      if (d.date >= d30Str && d.date <= todayStr) last30 += d.value;
      else if (d.date < d30Str) prior30 += d.value;
    }
    return { metric, last30, prior30, daily: series };
  });

  return { tiles, lastDataDate, earliestDataDate };
}

export type RankAnnotation =
  | { kind: "nr" }
  | { kind: "nr_lost"; priorRank: number }
  | { kind: "rank"; rank: number; delta: number | null; isNew: boolean; isWrongPage: boolean; actualUrl: string | null };

export type RankingsOverviewRow = {
  trackedKeywordId: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  keyword: string;
  bareKeyword: string | null;
  targetUrl: string;
  geoCity: string | null;
  isActive: boolean;
  lastCheckedAt: Date | null;
  national: RankAnnotation;
  geoFull: RankAnnotation | null;
  geoBare: RankAnnotation | null;
};

function buildAnnotation(
  currentRank: number | null,
  currentUrl: string | null,
  priorRank: number | null,
  targetUrl: string,
): RankAnnotation {
  if (currentRank == null) {
    if (priorRank != null) return { kind: "nr_lost", priorRank };
    return { kind: "nr" };
  }
  const isWrongPage =
    currentUrl != null &&
    stripTrailingSlash(currentUrl) !== stripTrailingSlash(targetUrl);
  const isNew = priorRank == null;
  // delta convention matches the spreadsheet: positive = improved (rank
  // moved closer to #1). e.g., went from #18 to #13 → delta=+5.
  const delta = priorRank != null ? priorRank - currentRank : null;
  return { kind: "rank", rank: currentRank, delta, isNew, isWrongPage, actualUrl: currentUrl };
}

export async function getRankingsOverview(
  filterClientId?: string,
): Promise<RankingsOverviewRow[]> {
  const where = filterClientId
    ? and(
        eq(trackedKeywords.isActive, true),
        eq(trackedKeywords.clientId, filterClientId),
      )
    : eq(trackedKeywords.isActive, true);

  const keywords = await db
    .select({
      kwId: trackedKeywords.id,
      clientId: trackedKeywords.clientId,
      clientName: clients.name,
      clientSlug: clients.slug,
      keyword: trackedKeywords.keyword,
      targetUrl: trackedKeywords.targetUrl,
      geoCity: trackedKeywords.geoCity,
      isActive: trackedKeywords.isActive,
    })
    .from(trackedKeywords)
    .innerJoin(clients, eq(trackedKeywords.clientId, clients.id))
    .where(where)
    .orderBy(clients.name, desc(trackedKeywords.createdAt));

  if (keywords.length === 0) return [];

  const cutoff = new Date(Date.now() - 90 * 86_400_000);
  const recent = await db.query.serpRankings.findMany({
    where: gte(serpRankings.checkedAt, cutoff),
    orderBy: [desc(serpRankings.checkedAt)],
  });

  const byKeyword = new Map<string, typeof recent>();
  for (const r of recent) {
    const list = byKeyword.get(r.trackedKeywordId);
    if (list) list.push(r);
    else byKeyword.set(r.trackedKeywordId, [r]);
  }

  return keywords.map((kw) => {
    const rows = byKeyword.get(kw.kwId) ?? [];
    const latest = rows[0] ?? null;
    const prior = rows[1] ?? null;

    const detection = detectCity(kw.keyword);
    const effectiveCity = detection.city ?? kw.geoCity ?? null;
    const bareKeyword =
      detection.city && detection.bareKeyword !== kw.keyword
        ? detection.bareKeyword
        : null;

    const national = buildAnnotation(
      latest?.nationalRank ?? null,
      latest?.nationalUrl ?? null,
      prior?.nationalRank ?? null,
      kw.targetUrl,
    );

    const geoFull = effectiveCity
      ? buildAnnotation(
          latest?.geoRank ?? null,
          latest?.geoUrl ?? null,
          prior?.geoRank ?? null,
          kw.targetUrl,
        )
      : null;

    const geoBare = bareKeyword
      ? buildAnnotation(
          latest?.geoBareRank ?? null,
          latest?.geoBareUrl ?? null,
          prior?.geoBareRank ?? null,
          kw.targetUrl,
        )
      : null;

    return {
      trackedKeywordId: kw.kwId,
      clientId: kw.clientId,
      clientName: kw.clientName,
      clientSlug: kw.clientSlug,
      keyword: kw.keyword,
      bareKeyword,
      targetUrl: kw.targetUrl,
      geoCity: effectiveCity,
      isActive: kw.isActive,
      lastCheckedAt: latest?.checkedAt ?? null,
      national,
      geoFull,
      geoBare,
    };
  });
}
