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
  type SerpOrganicItem,
} from "./dataforseo";

const SCAN_CONCURRENCY = 4;
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

      // Three searches per keyword:
      //  1. national: full keyword, no location
      //  2. geo (full kw): full keyword, from within the city
      //  3. geo (bare kw): keyword with city stripped, from within the city
      // The city is auto-detected from the keyword text; if detection fails,
      // we fall back to the explicit geoCity on the tracked_keyword (which
      // covers cases where the city isn't in the keyword text).

      let nationalItems: SerpOrganicItem[] | null = null;
      try {
        nationalItems = await pullOrganicSerp(kw.keyword);
      } catch (err) {
        throw new Error(`national: ${(err as Error).message}`);
      }
      const nationalMatch = findOrganicRankForDomain(nationalItems, hostname);

      const detection = detectCity(kw.keyword);
      const effectiveCity = detection.city ?? kw.geoCity ?? null;
      const effectiveCode = effectiveCity
        ? (METRO_LOCATIONS[effectiveCity] ?? kw.geoLocationCode ?? null)
        : (kw.geoLocationCode ?? null);

      let geoMatch: { rank: number | null; url: string | null } = {
        rank: null,
        url: null,
      };
      let geoBareMatch: { rank: number | null; url: string | null } = {
        rank: null,
        url: null,
      };

      if (effectiveCode) {
        let geoItems: SerpOrganicItem[] | null = null;
        try {
          geoItems = await pullOrganicSerp(kw.keyword, effectiveCode);
        } catch (err) {
          throw new Error(`geo: ${(err as Error).message}`);
        }
        geoMatch = findOrganicRankForDomain(geoItems, hostname);

        // Only do the bare search if the city was detected IN the keyword
        // (so we have a meaningful "bare" version). If detection failed but
        // the user set an explicit geoCity, the bare and full are the same.
        if (detection.city && detection.bareKeyword !== kw.keyword) {
          let bareItems: SerpOrganicItem[] | null = null;
          try {
            bareItems = await pullOrganicSerp(
              detection.bareKeyword,
              effectiveCode,
            );
          } catch (err) {
            throw new Error(`geo-bare: ${(err as Error).message}`);
          }
          geoBareMatch = findOrganicRankForDomain(bareItems, hostname);
        }
      }

      await db.insert(serpRankings).values({
        trackedKeywordId: kw.id,
        clientId: kw.clientId,
        keyword: kw.keyword,
        targetUrl: kw.targetUrl,
        nationalRank: nationalMatch.rank,
        nationalUrl: nationalMatch.url,
        geoRank: geoMatch.rank,
        geoUrl: geoMatch.url,
        geoBareRank: geoBareMatch.rank,
        geoBareUrl: geoBareMatch.url,
        geoCity: effectiveCity,
        geoLocationCode: effectiveCode,
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
