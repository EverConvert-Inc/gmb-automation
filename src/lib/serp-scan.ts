import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { serpRankings, serpScanJobs, trackedKeywords } from "./db/schema";
import {
  dispatchWithConcurrency,
  extractHostname,
  findOrganicRankForDomain,
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

      let nationalItems: SerpOrganicItem[] | null = null;
      try {
        nationalItems = await pullOrganicSerp(kw.keyword);
      } catch (err) {
        throw new Error(`national: ${(err as Error).message}`);
      }
      const nationalMatch = findOrganicRankForDomain(nationalItems, hostname);

      let geoMatch: { rank: number | null; url: string | null } = {
        rank: null,
        url: null,
      };
      if (kw.geoLocationCode) {
        let geoItems: SerpOrganicItem[] | null = null;
        try {
          geoItems = await pullOrganicSerp(kw.keyword, kw.geoLocationCode);
        } catch (err) {
          throw new Error(`geo: ${(err as Error).message}`);
        }
        geoMatch = findOrganicRankForDomain(geoItems, hostname);
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
        geoCity: kw.geoCity,
        geoLocationCode: kw.geoLocationCode,
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
      recordError(keywords[i].keyword, (r.reason as Error).message ?? String(r.reason));
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
