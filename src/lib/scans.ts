import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { gridConfigs, keywords, locations, scanPoints, scans } from "./db/schema";
import { generateGrid } from "./grid";
import {
  dispatchWithConcurrency,
  estimateScanCost,
  postTasks,
  type DataForSeoTask,
} from "./dataforseo";

export type CreateScanInput = {
  locationId: string;
  gridConfigId?: string;
  triggeredBy: "scheduled" | "manual" | "api";
};

export async function createAndDispatchScan({
  locationId,
  gridConfigId,
  triggeredBy,
}: CreateScanInput): Promise<{ scanId: string; totalPoints: number }> {
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) throw new Error(`Location ${locationId} not found`);
  if (!location.placeId) throw new Error(`Location ${locationId} missing placeId`);

  const config = gridConfigId
    ? await db.query.gridConfigs.findFirst({ where: eq(gridConfigs.id, gridConfigId) })
    : await db.query.gridConfigs.findFirst({
        where: (cols, ops) =>
          ops.and(ops.eq(cols.locationId, locationId), ops.eq(cols.isDefault, true)),
      });
  if (!config) throw new Error(`No grid config available for location ${locationId}`);

  const locationKeywords = await db.query.keywords.findMany({
    where: eq(keywords.locationId, locationId),
  });
  if (locationKeywords.length === 0) {
    throw new Error(`Location ${locationId} has no keywords`);
  }

  const gridPoints = generateGrid({
    centerLat: Number(location.lat),
    centerLng: Number(location.lng),
    size: config.size,
    radiusMiles: Number(config.radiusMiles),
  });

  const totalPoints = gridPoints.length * locationKeywords.length;

  const [scan] = await db
    .insert(scans)
    .values({
      locationId,
      gridConfigId: config.id,
      triggeredBy,
      status: "running",
      totalPoints,
      totalKeywords: locationKeywords.length,
      costEstimate: estimateScanCost(config.size, locationKeywords.length).toFixed(4),
    })
    .returning();

  const insertedPoints = await db
    .insert(scanPoints)
    .values(
      gridPoints.flatMap((gp) =>
        locationKeywords.map((kw) => ({
          scanId: scan.id,
          keywordId: kw.id,
          gridX: gp.gridX,
          gridY: gp.gridY,
          lat: gp.lat.toFixed(7),
          lng: gp.lng.toFixed(7),
          status: "pending",
        })),
      ),
    )
    .returning({
      id: scanPoints.id,
      keywordId: scanPoints.keywordId,
      gridX: scanPoints.gridX,
      gridY: scanPoints.gridY,
      lat: scanPoints.lat,
      lng: scanPoints.lng,
    });

  const postbackBase = process.env.DATAFORSEO_POSTBACK_URL;
  const postbackSecret = process.env.DATAFORSEO_POSTBACK_SECRET;
  if (!postbackBase || !postbackSecret) {
    throw new Error("DATAFORSEO_POSTBACK_URL and DATAFORSEO_POSTBACK_SECRET must be set");
  }
  const postbackUrl = `${postbackBase}?token=${encodeURIComponent(postbackSecret)}`;

  const keywordById = new Map(locationKeywords.map((k) => [k.id, k]));
  const tasks: DataForSeoTask[] = insertedPoints.map((p) => ({
    keyword: keywordById.get(p.keywordId)!.keyword,
    lat: Number(p.lat),
    lng: Number(p.lng),
    tag: {
      scanId: scan.id,
      scanPointId: p.id,
      keywordId: p.keywordId,
      gridX: p.gridX,
      gridY: p.gridY,
    },
    postbackUrl,
  }));

  const CHUNK_SIZE = 100;
  const CONCURRENCY = 10;
  const chunks: DataForSeoTask[][] = [];
  for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
    chunks.push(tasks.slice(i, i + CHUNK_SIZE));
  }

  const results = await dispatchWithConcurrency(chunks, CONCURRENCY, (chunk) =>
    postTasks(chunk),
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length === results.length) {
    await db
      .update(scans)
      .set({
        status: "errored",
        errorDetail: `All ${failed.length} dispatch chunks failed`,
        completedAt: new Date(),
      })
      .where(eq(scans.id, scan.id));
    throw new Error("Scan dispatch failed: all chunks rejected");
  }

  return { scanId: scan.id, totalPoints };
}

export async function maybeCompleteScan(scanId: string): Promise<void> {
  const pending = await db.query.scanPoints.findMany({
    where: (cols, ops) =>
      ops.and(ops.eq(cols.scanId, scanId), ops.eq(cols.status, "pending")),
    columns: { id: true },
    limit: 1,
  });
  if (pending.length > 0) return;

  await db
    .update(scans)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(scans.id, scanId));
}
