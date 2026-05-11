import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { gridConfigs, keywords, locations, scanPoints, scans } from "./db/schema";
import { generateGrid } from "./grid";
import {
  dispatchWithConcurrency,
  estimateScanCost,
  postTasks,
  type DataForSeoTask,
} from "./dataforseo";

export const ALLOWED_GRID_SIZES = [3, 5, 7, 9, 11, 13] as const;
export type AllowedGridSize = (typeof ALLOWED_GRID_SIZES)[number];

export class ScanAlreadyRunningError extends Error {
  constructor(locationId: string) {
    super(`A scan is already running for location ${locationId}`);
    this.name = "ScanAlreadyRunningError";
  }
}

export class InvalidScanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScanInputError";
  }
}

export type CreateScanInput = {
  locationId: string;
  gridConfigId?: string;
  newGridConfig?: { size: AllowedGridSize; radiusMiles: number; name?: string };
  keywordIds?: string[];
  newKeywords?: string[];
  triggeredBy: "scheduled" | "manual" | "api";
};

function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function createAndDispatchScan({
  locationId,
  gridConfigId,
  newGridConfig,
  keywordIds,
  newKeywords,
  triggeredBy,
}: CreateScanInput): Promise<{ scanId: string; totalPoints: number }> {
  if (gridConfigId && newGridConfig) {
    throw new InvalidScanInputError(
      "Provide either gridConfigId or newGridConfig, not both",
    );
  }

  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) throw new Error(`Location ${locationId} not found`);
  if (!location.placeId) throw new Error(`Location ${locationId} missing placeId`);

  const active = await db.query.scans.findFirst({
    where: and(
      eq(scans.locationId, locationId),
      inArray(scans.status, ["queued", "running"]),
    ),
    columns: { id: true },
  });
  if (active) throw new ScanAlreadyRunningError(locationId);

  let config;
  if (newGridConfig) {
    const [inserted] = await db
      .insert(gridConfigs)
      .values({
        locationId,
        name:
          newGridConfig.name?.trim() ||
          `Custom ${newGridConfig.size}x${newGridConfig.size} · ${newGridConfig.radiusMiles}mi`,
        size: newGridConfig.size,
        radiusMiles: newGridConfig.radiusMiles.toFixed(2),
        isDefault: false,
      })
      .returning();
    config = inserted;
  } else if (gridConfigId) {
    config = await db.query.gridConfigs.findFirst({
      where: and(eq(gridConfigs.id, gridConfigId), eq(gridConfigs.locationId, locationId)),
    });
    if (!config) {
      throw new InvalidScanInputError(
        `Grid config ${gridConfigId} not found for location ${locationId}`,
      );
    }
  } else {
    config = await db.query.gridConfigs.findFirst({
      where: and(eq(gridConfigs.locationId, locationId), eq(gridConfigs.isDefault, true)),
    });
  }
  if (!config) throw new Error(`No grid config available for location ${locationId}`);

  const resolvedNewKeywords = (newKeywords ?? [])
    .map(normalizeKeyword)
    .filter((kw) => kw.length > 0);
  const uniqueNewKeywords = Array.from(new Set(resolvedNewKeywords));

  if (uniqueNewKeywords.length > 0) {
    await db
      .insert(keywords)
      .values(
        uniqueNewKeywords.map((kw) => ({
          locationId,
          keyword: kw,
          isPrimary: false,
        })),
      )
      .onConflictDoNothing({
        target: [keywords.locationId, keywords.keyword],
      });
  }

  let locationKeywords;
  if ((keywordIds && keywordIds.length > 0) || uniqueNewKeywords.length > 0) {
    const explicitIds = keywordIds ?? [];
    if (explicitIds.length > 0) {
      const owned = await db.query.keywords.findMany({
        where: and(
          eq(keywords.locationId, locationId),
          inArray(keywords.id, explicitIds),
        ),
        columns: { id: true },
      });
      if (owned.length !== explicitIds.length) {
        throw new InvalidScanInputError(
          "One or more keywordIds do not belong to this location",
        );
      }
    }

    const newlyResolved =
      uniqueNewKeywords.length > 0
        ? await db.query.keywords.findMany({
            where: and(
              eq(keywords.locationId, locationId),
              inArray(keywords.keyword, uniqueNewKeywords),
            ),
          })
        : [];

    const wantedIds = new Set<string>(explicitIds);
    for (const kw of newlyResolved) wantedIds.add(kw.id);

    locationKeywords = await db.query.keywords.findMany({
      where: and(
        eq(keywords.locationId, locationId),
        inArray(keywords.id, Array.from(wantedIds)),
      ),
    });
  } else {
    locationKeywords = await db.query.keywords.findMany({
      where: eq(keywords.locationId, locationId),
    });
  }

  if (locationKeywords.length === 0) {
    throw new InvalidScanInputError(
      `Location ${locationId} has no keywords selected for this scan`,
    );
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
