import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getMonthlyDataForSeoSpendUsd } from "@/lib/dataforseo";

export const runtime = "nodejs";

// Cache for 15 minutes per Vercel function invocation; the SEO API spend
// drifts slowly enough that fresher data wouldn't change the operator's
// decisions. unstable_cache is per-deployment, not per-request.
const cachedFetch = unstable_cache(
  async () => {
    const spentUsd = await getMonthlyDataForSeoSpendUsd();
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    return {
      spentUsd,
      sinceIso: monthStart.toISOString().slice(0, 10),
      asOfIso: now.toISOString(),
    };
  },
  ["seo-api-spend-mtd"],
  { revalidate: 900, tags: ["seo-api-spend"] },
);

export async function GET() {
  const payload = await cachedFetch();
  return NextResponse.json(payload, {
    headers: {
      // Browsers shouldn't cache longer than the server's TTL — the
      // indicator's swr fetch handles its own staleness.
      "Cache-Control": "private, max-age=60",
    },
  });
}
