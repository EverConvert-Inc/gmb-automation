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

  for (const task of tasks) {
    if (!task.tag) continue;
    const decoded = decodeTag(task.tag);
    if (!decoded) continue;

    const point = await db.query.scanPoints.findFirst({
      where: eq(scanPoints.id, decoded.scanPointId),
    });
    if (!point) continue;

    const scan = await db.query.scans.findFirst({ where: eq(scans.id, point.scanId) });
    if (!scan) continue;

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, scan.locationId),
    });
    if (!location) continue;

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
      continue;
    }

    const { rank, competitors } = findRankForPlaceId(result, location.placeId);

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
  }

  for (const scanId of scanIdsTouched) {
    await maybeCompleteScan(scanId);
  }

  return NextResponse.json({ ok: true, processed: tasks.length });
}
