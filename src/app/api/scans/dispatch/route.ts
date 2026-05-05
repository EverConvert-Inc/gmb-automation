import { NextResponse } from "next/server";
import { z } from "zod";
import { createAndDispatchScan } from "@/lib/scans";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  locationId: z.string().uuid(),
  gridConfigId: z.string().uuid().optional(),
  triggeredBy: z.enum(["scheduled", "manual", "api"]).default("manual"),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  try {
    const result = await createAndDispatchScan(parsed);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
