import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scanPoints, scans } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ locationId: string }> },
) {
  const { locationId } = await params;
  const url = new URL(req.url);
  const scanIdParam = url.searchParams.get("scanId");

  const scan = scanIdParam
    ? await db.query.scans.findFirst({
        where: and(
          eq(scans.id, scanIdParam),
          eq(scans.locationId, locationId),
        ),
      })
    : await db.query.scans.findFirst({
        where: eq(scans.locationId, locationId),
        orderBy: (cols, ops) => ops.desc(cols.startedAt),
      });

  if (!scan) {
    return NextResponse.json({ scan: null, points: [], completedPoints: 0 });
  }

  const points = await db.query.scanPoints.findMany({
    where: eq(scanPoints.scanId, scan.id),
  });

  const completedPoints = points.filter(
    (p) => p.status === "completed" || p.status === "errored",
  ).length;

  return NextResponse.json({
    scan: {
      id: scan.id,
      status: scan.status,
      startedAt: scan.startedAt,
      completedAt: scan.completedAt,
    },
    points: points.map((p) => ({
      gridX: p.gridX,
      gridY: p.gridY,
      lat: Number(p.lat),
      lng: Number(p.lng),
      rank: p.rank ?? null,
      status: p.status,
      keywordId: p.keywordId,
      competitors:
        (p.competitorsJson as Array<{ placeId: string; name: string; rank: number }>) ??
        [],
    })),
    completedPoints,
  });
}
