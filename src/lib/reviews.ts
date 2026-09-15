import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  clients,
  gbpFetchDiagnostics,
  locationDailyMetrics,
  locations,
  oauthCredentials,
  reviewTakedownAlerts,
  reviews,
} from "./db/schema";
import { fetchReviews } from "./gbp";

// How long a review has to be continuously absent from a full GBP sweep
// before we treat it as a confirmed takedown (vs. a transient API blip or
// pagination hiccup) and fire an alert. This is elapsed time, not a poll
// count: the poll cron runs every 15 min but only actually checks a location
// when its own pollFrequency interval is due (locations default to "daily"),
// so "4 consecutive 15-min polls" doesn't hold for most locations as
// configured today. Using elapsed time means detection latency is simply
// bounded by whatever cadence a location is polled at — for an hourly
// location that's ~1-2 poll cycles; for a daily one, effectively the next
// poll after this window has passed.
export const TAKEDOWN_CONFIRM_MINUTES = 60;

// Mapping from a location's pollFrequency to how long to wait before the
// next successful poll. "manual" is used by listLocationsDueForPolling to
// exclude a location from automatic polling entirely.
export const POLL_INTERVAL_MINUTES: Record<string, number> = {
  hourly: 60,
  daily: 60 * 24,
  weekly: 60 * 24 * 7,
};

export function nextSuccessPollDate(
  frequency: string,
  from: Date = new Date(),
): Date {
  const minutes = POLL_INTERVAL_MINUTES[frequency] ?? POLL_INTERVAL_MINUTES.daily;
  return new Date(from.getTime() + minutes * 60_000);
}

// Capped exponential backoff for consecutive failures. Tuned to the 15-min
// cron cadence: first retry happens in the next slot, then we back off so we
// don't hammer GBP for a persistent failure (e.g. wrong Google account
// connected, expired refresh token).
const BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480, 1440];
export function nextFailurePollDate(
  consecutiveFailures: number,
  from: Date = new Date(),
): Date {
  const idx = Math.min(Math.max(consecutiveFailures, 1), BACKOFF_MINUTES.length) - 1;
  return new Date(from.getTime() + BACKOFF_MINUTES[idx] * 60_000);
}

// Alert once a location's poll has failed this many times in a row — not on
// every failure, since backoff already retries on its own and most failures
// self-heal within a cycle or two. Callers check justCrossedAlertThreshold
// (true only the poll where the count first reaches this) so a location
// stuck failing for days doesn't re-alert on every subsequent attempt.
export const POLL_FAILURE_ALERT_THRESHOLD = 3;

export class LocationPollError extends Error {
  constructor(
    message: string,
    public readonly locationId: string,
    public readonly locationName: string,
    public readonly clientName: string,
    public readonly consecutiveFailures: number,
    public readonly justCrossedAlertThreshold: boolean,
  ) {
    super(message);
    this.name = "LocationPollError";
  }
}

export type ConfirmedTakedown = {
  reviewId: string;
  rating: number;
  reviewerName: string | null;
  text: string | null;
  reviewCreatedAt: Date;
  lastSeenAt: Date;
  detectedMissingAt: Date;
  clientName: string;
  // The business's public Google Maps listing — not a link to the review
  // itself (GBP's v4 reviews API exposes no per-review URL). Null for
  // locations onboarded before this field existed; there's no backfill job.
  mapsUrl: string | null;
};

export async function pollReviewsForLocation(locationId: string): Promise<{
  ingested: number;
  newLowRated: Array<{
    rating: number;
    reviewerName: string | null;
    text: string | null;
    reviewCreatedAt: string;
  }>;
  confirmedTakedowns: ConfirmedTakedown[];
}> {
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) throw new Error(`Location ${locationId} not found`);

  try {
    if (!location.gbpOauthTokenId || !location.gbpAccountId || !location.gbpLocationId) {
      throw new Error(`Location not fully connected to Google Business Profile`);
    }
    const cred = await db.query.oauthCredentials.findFirst({
      where: eq(oauthCredentials.id, location.gbpOauthTokenId),
    });
    if (!cred) throw new Error(`Missing OAuth credential for this location`);

    // fullSweep: true is what makes takedown detection possible at all — it
    // fetches every review GBP currently returns instead of only what
    // changed since the last poll (see fetchReviews' fullSweep doc). At this
    // scale (~30 locations, typically <50 reviews each) that's still
    // usually a single API page per location.
    const { reviews: fresh, pageDiagnostics } = await fetchReviews({
      accountId: location.gbpAccountId,
      locationId: location.gbpLocationId,
      refreshTokenEncrypted: cred.refreshTokenEncrypted,
      // Always a full sweep — required for takedown detection (a review
      // that's still there but unchanged would never reappear under an
      // incremental updatedSince fetch, so we'd never notice it was
      // seen — see fetchReviews' fullSweep doc). This used to be
      // opt-in via an `opts.full` param (an incremental-vs-full choice
      // via updatedSince) for the manual sync routes specifically; now
      // moot since every poll is unconditionally full, so that param
      // was removed rather than left as dead weight.
      fullSweep: true,
    });

    const now = new Date();

    // TEMPORARY — see gbpFetchDiagnostics in schema.ts. Persisted for every
    // sweep, not just suspicious ones, so we can see what a normal sweep
    // looks like too (page counts, headers) for comparison once an
    // incomplete one shows up.
    if (pageDiagnostics.length > 0) {
      await db.insert(gbpFetchDiagnostics).values(
        pageDiagnostics.map((d) => ({
          locationId,
          gbpAccountId: location.gbpAccountId!,
          fetchedAt: now,
          pageNumber: d.pageNumber,
          pageReviewCount: d.pageReviewCount,
          hasNextPageToken: d.hasNextPageToken,
          responseStatus: d.responseStatus,
          responseHeaders: d.responseHeaders,
        })),
      );
    }

    const newLowRated: Array<{
      rating: number;
      reviewerName: string | null;
      text: string | null;
      reviewCreatedAt: string;
    }> = [];

    const freshIds = fresh.map((r) => r.reviewId);

    for (const r of fresh) {
      const existing = await db.query.reviews.findFirst({
        where: eq(reviews.gbpReviewId, r.reviewId),
      });
      if (existing) {
        await db
          .update(reviews)
          .set({
            rating: r.rating,
            text: r.text,
            updatedAt: new Date(r.updatedAt),
            replyText: r.reply?.text ?? null,
            repliedAt: r.reply ? new Date(r.reply.updatedAt) : null,
            lastSeenAt: now,
            missingSinceAt: null,
          })
          .where(eq(reviews.id, existing.id));
      } else {
        await db.insert(reviews).values({
          locationId,
          gbpReviewId: r.reviewId,
          rating: r.rating,
          text: r.text,
          reviewerName: r.reviewerName,
          reviewerPhotoUrl: r.reviewerPhotoUrl,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
          replyText: r.reply?.text ?? null,
          repliedAt: r.reply ? new Date(r.reply.updatedAt) : null,
          lastSeenAt: now,
        });
        if (r.rating <= 3) {
          newLowRated.push({
            rating: r.rating,
            reviewerName: r.reviewerName,
            text: r.text,
            reviewCreatedAt: r.createdAt,
          });
        }
      }
    }

    const { confirmed: rawTakedowns, partialSweepDetected, partialSweepDetail } =
      await detectAndConfirmTakedowns({
        locationId,
        clientId: location.clientId,
        freshIds,
        now,
      });
    let confirmedTakedowns: ConfirmedTakedown[] = [];
    if (rawTakedowns.length > 0) {
      const clientRow = await db.query.clients.findFirst({
        where: eq(clients.id, location.clientId),
        columns: { name: true },
      });
      confirmedTakedowns = rawTakedowns.map((t) => ({
        ...t,
        clientName: clientRow?.name ?? "Unknown client",
        mapsUrl: location.placeGoogleMapsUri,
      }));
    }

    await db
      .update(locations)
      .set({
        lastPolledAt: now,
        lastPollError: null,
        lastPollErrorAt: null,
        consecutivePollFailures: 0,
        nextPollAfter: nextSuccessPollDate(location.pollFrequency, now),
        // partialSweepCount is cumulative — never reset here, only bumped
        // when this specific poll actually tripped the guard, so it answers
        // "how often has this ever fired" without needing Cloud Console.
        ...(partialSweepDetected
          ? {
              partialSweepCount: location.partialSweepCount + 1,
              lastPartialSweepAt: now,
              lastPartialSweepDetail: partialSweepDetail,
            }
          : {}),
      })
      .where(eq(locations.id, locationId));

    await upsertDailyMetricsForToday(locationId);

    return { ingested: fresh.length, newLowRated, confirmedTakedowns };
  } catch (err) {
    const now = new Date();
    const nextFailures = location.consecutivePollFailures + 1;
    await db
      .update(locations)
      .set({
        lastPollError: (err as Error).message,
        lastPollErrorAt: now,
        consecutivePollFailures: nextFailures,
        nextPollAfter: nextFailurePollDate(nextFailures, now),
      })
      .where(eq(locations.id, locationId));

    const justCrossedAlertThreshold =
      location.consecutivePollFailures < POLL_FAILURE_ALERT_THRESHOLD &&
      nextFailures >= POLL_FAILURE_ALERT_THRESHOLD;

    // Client name is only needed for the alert payload, so only look it up
    // on the (rare) poll that actually crosses the threshold.
    let clientName = "";
    if (justCrossedAlertThreshold) {
      const clientRow = await db.query.clients.findFirst({
        where: eq(clients.id, location.clientId),
        columns: { name: true },
      });
      clientName = clientRow?.name ?? "Unknown client";
    }

    throw new LocationPollError(
      (err as Error).message,
      locationId,
      location.name,
      clientName,
      nextFailures,
      justCrossedAlertThreshold,
    );
  }
}

// Diffs this poll's full sweep against what we have stored for the location,
// marks reviews that dropped out as missing (or clears that flag if they
// reappeared), and returns any review that just crossed the confirmation
// threshold for the first time — i.e. newly confirmed takedowns this poll,
// not ones already confirmed on a prior poll.
async function detectAndConfirmTakedowns({
  locationId,
  clientId,
  freshIds,
  now,
}: {
  locationId: string;
  clientId: string;
  freshIds: string[];
  now: Date;
}): Promise<{
  confirmed: Omit<ConfirmedTakedown, "clientName" | "mapsUrl">[];
  partialSweepDetected: boolean;
  partialSweepDetail: string | null;
}> {
  const activeBefore = await db.query.reviews.findMany({
    where: and(eq(reviews.locationId, locationId), isNull(reviews.missingSinceAt)),
    columns: { id: true, gbpReviewId: true },
  });

  // Defensive: a sweep can come back from Google with res.ok === true (no
  // thrown error, so this never shows up as a poll failure) while still
  // silently returning fewer reviews than actually exist — confirmed in
  // production Sept 2026: dozens of reviews across unrelated locations got
  // marked missing (and some confirmed as false-positive "takedowns") from
  // sweeps that quietly came back short, including on locations small enough
  // that pagination wasn't even involved. A drop has to clear BOTH a
  // percentage and an absolute-count bar to count as suspicious — percentage
  // alone over-triggers on small locations (losing 1 of 4 reviews is 25%),
  // absolute count alone over-triggers on large ones (losing 5 of 500 is
  // noise). The old "completely empty" check is kept as an unconditional
  // special case since it protects locations with too few reviews (<=3) for
  // the percentage+count combination to ever trip on a total wipeout.
  const PARTIAL_SWEEP_DROP_PCT = 0.15;
  const PARTIAL_SWEEP_MIN_ABSOLUTE = 3;
  const droppedCount = activeBefore.length - freshIds.length;
  const suspiciousEmptySweep = freshIds.length === 0 && activeBefore.length > 0;
  const suspiciousPartialSweep =
    suspiciousEmptySweep ||
    (activeBefore.length > 0 &&
      freshIds.length < activeBefore.length * (1 - PARTIAL_SWEEP_DROP_PCT) &&
      droppedCount > PARTIAL_SWEEP_MIN_ABSOLUTE);

  let partialSweepDetail: string | null = null;
  if (suspiciousPartialSweep) {
    const dropPct = Math.round((droppedCount / activeBefore.length) * 100);
    partialSweepDetail = `Sweep returned ${freshIds.length} of ${activeBefore.length} previously-active reviews (${dropPct}% drop) — missing-detection skipped this poll`;
  } else {
    const freshIdSet = new Set(freshIds);
    const stillMissingIds = activeBefore
      .filter((r) => !freshIdSet.has(r.gbpReviewId))
      .map((r) => r.id);
    if (stillMissingIds.length > 0) {
      await db
        .update(reviews)
        .set({ missingSinceAt: now })
        .where(inArray(reviews.id, stillMissingIds));
    }
  }

  const confirmThreshold = new Date(now.getTime() - TAKEDOWN_CONFIRM_MINUTES * 60_000);
  const candidates = await db.query.reviews.findMany({
    where: and(
      eq(reviews.locationId, locationId),
      isNotNull(reviews.missingSinceAt),
      lte(reviews.missingSinceAt, confirmThreshold),
    ),
  });

  const confirmed: Omit<ConfirmedTakedown, "clientName" | "mapsUrl">[] = [];
  for (const r of candidates) {
    const [inserted] = await db
      .insert(reviewTakedownAlerts)
      .values({
        reviewId: r.id,
        locationId,
        clientId,
        rating: r.rating,
        text: r.text,
        reviewerName: r.reviewerName,
        reviewCreatedAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        detectedMissingAt: r.missingSinceAt!,
      })
      // where must exactly match the partial index's predicate
      // (review_takedown_alerts_active_review_idx in schema.ts) for
      // Postgres to associate this ON CONFLICT with that specific index —
      // otherwise a plain `target` alone won't match a partial unique index.
      .onConflictDoNothing({
        target: reviewTakedownAlerts.reviewId,
        where: sql`${reviewTakedownAlerts.status} <> 'resolved'`,
      })
      .returning();
    if (inserted) {
      confirmed.push({
        reviewId: r.id,
        rating: r.rating,
        reviewerName: r.reviewerName,
        text: r.text,
        reviewCreatedAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        detectedMissingAt: r.missingSinceAt!,
      });
    }
  }
  return { confirmed, partialSweepDetected: suspiciousPartialSweep, partialSweepDetail };
}

export async function upsertDailyMetricsForToday(locationId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const cutoff90 = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const agg = await db
    .select({
      avg: sql<number | null>`avg(${reviews.rating})`,
      count: sql<number>`count(${reviews.id})::int`,
      last: sql<Date | null>`max(${reviews.createdAt})`,
    })
    .from(reviews)
    .where(and(eq(reviews.locationId, locationId), isNull(reviews.missingSinceAt)));

  const last30 = await db
    .select({ count: sql<number>`count(${reviews.id})::int` })
    .from(reviews)
    .where(
      and(
        eq(reviews.locationId, locationId),
        gte(reviews.createdAt, new Date(cutoff30)),
        isNull(reviews.missingSinceAt),
      ),
    );

  const last90 = await db
    .select({ count: sql<number>`count(${reviews.id})::int` })
    .from(reviews)
    .where(
      and(
        eq(reviews.locationId, locationId),
        gte(reviews.createdAt, new Date(cutoff90)),
        isNull(reviews.missingSinceAt),
      ),
    );

  const lastReviewAt = agg[0]?.last ?? null;
  const daysSinceLastReview = lastReviewAt
    ? Math.floor((Date.now() - new Date(lastReviewAt).getTime()) / 86_400_000)
    : null;

  await db
    .insert(locationDailyMetrics)
    .values({
      locationId,
      metricDate: today,
      rating: agg[0]?.avg !== null && agg[0]?.avg !== undefined ? Number(agg[0].avg).toFixed(1) : null,
      reviewCount: agg[0]?.count ?? 0,
      reviewsLast30d: last30[0]?.count ?? 0,
      reviewsLast90d: last90[0]?.count ?? 0,
      daysSinceLastReview,
    })
    .onConflictDoUpdate({
      target: [locationDailyMetrics.locationId, locationDailyMetrics.metricDate],
      set: {
        rating:
          agg[0]?.avg !== null && agg[0]?.avg !== undefined ? Number(agg[0].avg).toFixed(1) : null,
        reviewCount: agg[0]?.count ?? 0,
        reviewsLast30d: last30[0]?.count ?? 0,
        reviewsLast90d: last90[0]?.count ?? 0,
        daysSinceLastReview,
      },
    });
}
