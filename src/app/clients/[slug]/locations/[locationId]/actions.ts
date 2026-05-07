"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scans } from "@/lib/db/schema";
import {
  InvalidScanInputError,
  ScanAlreadyRunningError,
  createAndDispatchScan,
} from "@/lib/scans";
import { getScanReplayConfig } from "@/lib/queries";

export type ReplayScanResult =
  | { ok: true; scanId: string; totalPoints: number; usedDefaultGrid: boolean }
  | { ok: false; error: string; code: "not_found" | "conflict" | "invalid" | "internal" };

export async function replayScan(scanId: string): Promise<ReplayScanResult> {
  const sourceScan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    columns: { locationId: true },
  });
  if (!sourceScan) {
    return { ok: false, error: "Original scan not found", code: "not_found" };
  }

  const replay = await getScanReplayConfig(scanId);
  if (!replay) {
    return { ok: false, error: "Original scan not found", code: "not_found" };
  }
  if (replay.keywordIds.length === 0) {
    return {
      ok: false,
      error: "Original scan has no keyword data to replay",
      code: "invalid",
    };
  }

  try {
    const result = await createAndDispatchScan({
      locationId: sourceScan.locationId,
      keywordIds: replay.keywordIds,
      gridConfigId: replay.gridConfigId ?? undefined,
      triggeredBy: "manual",
    });
    return {
      ok: true,
      scanId: result.scanId,
      totalPoints: result.totalPoints,
      usedDefaultGrid: replay.gridConfigId === null,
    };
  } catch (err) {
    if (err instanceof ScanAlreadyRunningError) {
      return { ok: false, error: err.message, code: "conflict" };
    }
    if (err instanceof InvalidScanInputError) {
      return { ok: false, error: err.message, code: "invalid" };
    }
    return { ok: false, error: (err as Error).message, code: "internal" };
  }
}
