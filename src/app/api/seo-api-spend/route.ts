import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getRawUserData } from "@/lib/dataforseo";
import { getMonthlyDataForSeoSpend } from "@/lib/dataforseo-spend";

export const runtime = "nodejs";

// Cache for 15 minutes per warm function instance. The snapshot upsert
// inside getMonthlyDataForSeoSpend() means every cache miss also keeps
// our local baseline fresh.
const cachedFetch = unstable_cache(
  async () => {
    const result = await getMonthlyDataForSeoSpend();
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    return {
      ...result,
      sinceIso: monthStart.toISOString().slice(0, 10),
      asOfIso: now.toISOString(),
    };
  },
  ["seo-api-spend-mtd-v2"],
  { revalidate: 900, tags: ["seo-api-spend"] },
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  // ?debug=1 returns the raw /v3/appendix/user_data response. Auth
  // piggybacks on the Supabase middleware that already gates /api/*.
  if (url.searchParams.get("debug") === "1") {
    const raw = await getRawUserData();
    return NextResponse.json(raw, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const payload = await cachedFetch();
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
