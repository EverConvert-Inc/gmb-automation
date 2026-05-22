import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { serpRankings, serpScanJobs, trackedKeywords } from "./db/schema";
import {
  detectCity,
  dispatchWithConcurrency,
  extractHostname,
  findOrganicRankForDomain,
  METRO_LOCATIONS,
  pullOrganicSerp,
  type GeoTarget,
} from "./dataforseo";

// 8 in-flight DataForSEO calls — well under their default rate limit and
// roughly halves wall-clock time vs. the previous 4 for an 8-keyword
// client. Combined with the 45s per-call timeout in pullOrganicSerp, a
// pathological scan should now complete (or fail cleanly per-keyword)
// inside the 300s Vercel maxDuration.
const SCAN_CONCURRENCY = 8;
const ERROR_BUFFER_LIMIT = 2000;

type RunSerpScanOptions = {
  clientIds?: string[];
  triggeredBy?: string;
};

export type RunSerpScanResult = {
  jobId: string;
  totalKeywords: number;
  completed: number;
  errored: number;
};

export async function runSerpScan(
  options: RunSerpScanOptions = {},
): Promise<RunSerpScanResult> {
  const { clientIds, triggeredBy = "scheduled" } = options;

  const filters = [eq(trackedKeywords.isActive, true)];
  if (clientIds && clientIds.length > 0) {
    filters.push(inArray(trackedKeywords.clientId, clientIds));
  }
  const keywords = await db.query.trackedKeywords.findMany({
    where: and(...filters),
  });

  const [job] = await db
    .insert(serpScanJobs)
    .values({
      status: keywords.length === 0 ? "completed" : "running",
      clientIds: clientIds ?? null,
      totalKeywords: keywords.length,
      completedKeywords: 0,
      startedAt: new Date(),
      completedAt: keywords.length === 0 ? new Date() : null,
      triggeredBy,
    })
    .returning({ id: serpScanJobs.id });

  if (keywords.length === 0) {
    return { jobId: job.id, totalKeywords: 0, completed: 0, errored: 0 };
  }

  let completedCount = 0;
  let erroredCount = 0;
  const errorBuffer: string[] = [];
  let errorBufferSize = 0;

  function recordError(keyword: string, message: string): void {
    const line = `[${keyword}] ${message}`;
    if (errorBufferSize + line.length + 1 > ERROR_BUFFER_LIMIT) return;
    errorBuffer.push(line);
    errorBufferSize += line.length + 1;
  }

  const results = await dispatchWithConcurrency(
    keywords,
    SCAN_CONCURRENCY,
    async (kw) => {
      const hostname = extractHostname(kw.targetUrl);
      if (!hostname) {
        throw new Error(`invalid target_url: ${kw.targetUrl}`);
      }

      // Two searches per keyword, both from the configured geo location:
      //  1. full kw: keyword as listed (e.g. "Atlanta car accident lawyer")
      //  2. bare kw: keyword with the city stripped ("car accident lawyer")
      // If the keyword has no city to strip (e.g. "Drug Rehab"), only #1
      // runs — bare would be identical.

      const detection = detectCity(kw.keyword);
      const effectiveCity = detection.city ?? kw.geoCity ?? null;

      // Prefer exact GPS coordinates (stored when the user picks a city
      // via the geocoded text input). Fall back to the legacy
      // location_code mapping for older rows that have geoLocationCode
      // but no lat/lng yet.
      let geoTarget: GeoTarget | null = null;
      if (kw.geoLat != null && kw.geoLng != null) {
        geoTarget = {
          kind: "coord",
          lat: Number(kw.geoLat),
          lng: Number(kw.geoLng),
        };
      } else {
        const code = effectiveCity
          ? (METRO_LOCATIONS[effectiveCity] ?? kw.geoLocationCode ?? null)
          : (kw.geoLocationCode ?? null);
        if (code) geoTarget = { kind: "code", code };
      }

      if (!geoTarget) {
        throw new Error(
          "no geo location set — re-save this keyword with a city",
        );
      }

      // Fire both DataForSEO calls in parallel. Each live/regular call is
      // independent and DataForSEO charges per call regardless of order,
      // so awaiting them sequentially was leaving half our wall-clock on
      // the floor. Settled rather than all() so we can keep distinct
      // "geo" vs "geo-bare" error messages.
      const doBare =
        detection.city && detection.bareKeyword !== kw.keyword;
      const [fullSettled, bareSettled] = await Promise.allSettled([
        pullOrganicSerp(kw.keyword, geoTarget),
        doBare
          ? pullOrganicSerp(detection.bareKeyword, geoTarget)
          : Promise.resolve(null),
      ]);

      if (fullSettled.status === "rejected") {
        throw new Error(`geo: ${(fullSettled.reason as Error).message}`);
      }
      if (bareSettled.status === "rejected") {
        throw new Error(
          `geo-bare: ${(bareSettled.reason as Error).message}`,
        );
      }

      const geoMatch = findOrganicRankForDomain(fullSettled.value, hostname);
      const geoBareMatch =
        bareSettled.value !== null
          ? findOrganicRankForDomain(bareSettled.value, hostname)
          : { rank: null, url: null };

      await db.insert(serpRankings).values({
        trackedKeywordId: kw.id,
        clientId: kw.clientId,
        keyword: kw.keyword,
        targetUrl: kw.targetUrl,
        nationalRank: null,
        nationalUrl: null,
        geoRank: geoMatch.rank,
        geoUrl: geoMatch.url,
        geoBareRank: geoBareMatch.rank,
        geoBareUrl: geoBareMatch.url,
        geoCity: effectiveCity,
        geoLocationCode:
          geoTarget.kind === "code" ? geoTarget.code : null,
        checkedAt: new Date(),
      });
    },
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      completedCount++;
    } else {
      erroredCount++;
      const msg = (r.reason as Error).message ?? String(r.reason);
      console.error(`[serp-scan] "${keywords[i].keyword}" failed: ${msg}`);
      recordError(keywords[i].keyword, msg);
    }
    if ((i + 1) % 5 === 0 || i === results.length - 1) {
      await db
        .update(serpScanJobs)
        .set({ completedKeywords: completedCount + erroredCount })
        .where(eq(serpScanJobs.id, job.id));
    }
  }

  const finalStatus =
    completedCount === 0 && erroredCount > 0 ? "failed" : "completed";
  await db
    .update(serpScanJobs)
    .set({
      status: finalStatus,
      completedKeywords: completedCount + erroredCount,
      completedAt: new Date(),
      errorMessage: errorBuffer.length > 0 ? errorBuffer.join("\n") : null,
    })
    .where(eq(serpScanJobs.id, job.id));

  return {
    jobId: job.id,
    totalKeywords: keywords.length,
    completed: completedCount,
    errored: erroredCount,
  };
}
