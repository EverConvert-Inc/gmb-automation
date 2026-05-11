import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ALLOWED_GRID_SIZES,
  InvalidScanInputError,
  ScanAlreadyRunningError,
  createAndDispatchScan,
} from "@/lib/scans";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z
  .object({
    locationId: z.string().uuid(),
    gridConfigId: z.string().uuid().optional(),
    newGridConfig: z
      .object({
        size: z.union(
          ALLOWED_GRID_SIZES.map((s) => z.literal(s)) as [
            z.ZodLiteral<3>,
            z.ZodLiteral<5>,
            z.ZodLiteral<7>,
            z.ZodLiteral<9>,
            z.ZodLiteral<11>,
            z.ZodLiteral<13>,
          ],
        ),
        radiusMiles: z.number().positive().max(50),
        name: z.string().trim().min(1).max(80).optional(),
      })
      .optional(),
    keywordIds: z.array(z.string().uuid()).optional(),
    newKeywords: z.array(z.string().min(1).max(120)).optional(),
    triggeredBy: z.enum(["scheduled", "manual", "api"]).default("manual"),
  })
  .refine((v) => !(v.gridConfigId && v.newGridConfig), {
    message: "Provide either gridConfigId or newGridConfig, not both",
    path: ["newGridConfig"],
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
    if (err instanceof ScanAlreadyRunningError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof InvalidScanInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
