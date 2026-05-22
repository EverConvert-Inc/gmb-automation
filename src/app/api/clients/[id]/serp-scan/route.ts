import { NextResponse } from "next/server";
import { runSerpScan } from "@/lib/serp-scan";

export const runtime = "nodejs";
// 300s = Vercel Pro max. A 30-keyword client = ~60 DataForSEO calls; at
// concurrency 8 with a 45s per-call timeout that's well under the cap.
export const maxDuration = 300;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const t0 = Date.now();
  const tag = `[serp-scan] client=${id.slice(0, 8)}`;
  try {
    console.log(`${tag} starting`);
    const result = await runSerpScan({
      clientIds: [id],
      triggeredBy: "manual",
    });
    console.log(
      `${tag} done jobId=${result.jobId.slice(0, 8)} total=${result.totalKeywords} ok=${result.completed} err=${result.errored} (${Date.now() - t0}ms)`,
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error(`${tag} error after ${Date.now() - t0}ms:`, err);
    return NextResponse.json(
      { error: (err as Error).message ?? "unknown error" },
      { status: 500 },
    );
  }
}
