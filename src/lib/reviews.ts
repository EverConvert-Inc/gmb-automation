import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db/client";
import { locationDailyMetrics, locations, oauthCredentials, reviews } from "./db/schema";
import { fetchReviews } from "./gbp";

export async function pollReviewsForLocation(locationId: string): Promise<{
  ingested: number;
  newLowRated: Array<{ rating: number; reviewerName: string | null; text: string | null }>;
}> {
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) throw new Error(`Location ${locationId} not found`);
  if (!location.gbpOauthTokenId || !location.gbpAccountId || !location.gbpLocationId) {
    throw new Error(`Location ${locationId} not connected to GBP`);
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, location.gbpOauthTokenId),
  });
  if (!cred) throw new Error(`Missing OAuth credential for location ${locationId}`);

  const fresh = await fetchReviews({
    accountId: location.gbpAccountId,
    locationId: location.gbpLocationId,
    refreshTokenEncrypted: cred.refreshTokenEncrypted,
    updatedSince: location.lastPolledAt ?? undefined,
  });

  const newLowRated: Array<{
    rating: number;
    reviewerName: string | null;
    text: string | null;
  }> = [];

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
      });
      if (r.rating <= 3) {
        newLowRated.push({ rating: r.rating, reviewerName: r.reviewerName, text: r.text });
      }
    }
  }

  await db
    .update(locations)
    .set({ lastPolledAt: new Date() })
    .where(eq(locations.id, locationId));

  await upsertDailyMetricsForToday(locationId);

  return { ingested: fresh.length, newLowRated };
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
    .where(eq(reviews.locationId, locationId));

  const last30 = await db
    .select({ count: sql<number>`count(${reviews.id})::int` })
    .from(reviews)
    .where(
      and(eq(reviews.locationId, locationId), gte(reviews.createdAt, new Date(cutoff30))),
    );

  const last90 = await db
    .select({ count: sql<number>`count(${reviews.id})::int` })
    .from(reviews)
    .where(
      and(eq(reviews.locationId, locationId), gte(reviews.createdAt, new Date(cutoff90))),
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
