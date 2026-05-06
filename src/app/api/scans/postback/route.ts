import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { db } from "@/lib/db/client";
import { locations, scanPoints, scans } from "@/lib/db/schema";
import {
  decodeTag,
  fetchTaskResult,
  findRankForPlaceId,
  type SerpMapsResult,
} from "@/lib/dataforseo";
import { maybeCompleteScan } from "@/lib/scans";
import { timingSafeEqual } from "@/lib/crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

type PostbackBody = {
  tasks?: Array<{
    id?: string;
    tag?: string;
    data?: { tag?: string; [k: string]: unknown };
    status_code?: number;
    status_message?: string;
    result?: SerpMapsResult[];
  }>;
};

async function readBody(req: Request): Promise<string> {
  const encoding = req.headers.get("content-encoding")?.toLowerCase() ?? "";
  if (!encoding || encoding === "identity") {
    return await req.text();
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (encoding.includes("gzip")) return gunzipSync(buf).toString("utf-8");
  if (encoding.includes("deflate")) return inflateSync(buf).toString("utf-8");
  if (encoding.includes("br")) return brotliDecompressSync(buf).toString("utf-8");
  return buf.toString("utf-8");
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const expected = process.env.DATAFORSEO_POSTBACK_SECRET ?? "";
  if (!expected || !timingSafeEqual(token, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await readBody(req);
  console.log("[postback] received", {
    length: raw.length,
    contentType: req.headers.get("content-type"),
    contentEncoding: req.headers.get("content-encoding"),
    preview: raw.slice(0, 200),
  });

  let body: PostbackBody;
  if (raw.length === 0) {
    body = {};
  } else {
    try {
      body = JSON.parse(raw) as PostbackBody;
    } catch (err) {
      console.error("[postback] JSON parse failed", {
        error: (err as Error).message,
        preview: raw.slice(0, 500),
      });
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
  }

  const tasks = body.tasks ?? [];
  const scanIdsTouched = new Set<string>();
  let updated = 0;
  let errored = 0;
  let skipped = 0;
  let ranked = 0;

  for (const [idx, task] of tasks.entries()) {
    const rawTag = task.tag ?? task.data?.tag;
    if (!rawTag) {
      skipped++;
      if (idx === 0) {
        console.log("[postback] task missing tag", {
          taskKeys: Object.keys(task),
          dataKeys: task.data ? Object.keys(task.data) : null,
          taskId: task.id,
        });
      }
      continue;
    }
    const decoded = decodeTag(rawTag);
    if (!decoded) {
      skipped++;
      console.log("[postback] could not decode tag", { tag: rawTag });
      continue;
    }

    const point = await db.query.scanPoints.findFirst({
      where: eq(scanPoints.id, decoded.scanPointId),
    });
    if (!point) {
      skipped++;
      console.log("[postback] no scan_point for id", { scanPointId: decoded.scanPointId });
      continue;
    }

    const scan = await db.query.scans.findFirst({ where: eq(scans.id, point.scanId) });
    if (!scan) {
      skipped++;
      continue;
    }

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, scan.locationId),
    });
    if (!location) {
      skipped++;
      continue;
    }

    let result = task.result?.[0];
    if (!result && task.id) {
      result = (await fetchTaskResult(task.id)) ?? undefined;
    }

    if (!result || (task.status_code && task.status_code >= 40000)) {
      await db
        .update(scanPoints)
        .set({
          status: "errored",
          erroredAt: new Date(),
          errorDetail: task.status_message ?? "missing result",
        })
        .where(eq(scanPoints.id, point.id));
      scanIdsTouched.add(scan.id);
      errored++;
      continue;
    }

    const { rank, competitors } = findRankForPlaceId(result, location.placeId);
    if (rank !== null) ranked++;

    await db
      .update(scanPoints)
      .set({
        rank: rank ?? null,
        competitorsJson: competitors,
        rawResponseRef: task.id ?? null,
        status: "completed",
      })
      .where(eq(scanPoints.id, point.id));

    scanIdsTouched.add(scan.id);
    updated++;
  }

  console.log("[postback] processed", {
    total: tasks.length,
    updated,
    ranked,
    errored,
    skipped,
  });

  for (const scanId of scanIdsTouched) {
    await maybeCompleteScan(scanId);
  }

  return NextResponse.json({ ok: true, processed: tasks.length });
}
