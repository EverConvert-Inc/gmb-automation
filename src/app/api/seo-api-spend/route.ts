import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import {
  getMonthlyDataForSeoSpendUsd,
  getRawMonthlyTransactions,
} from "@/lib/dataforseo";

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

export async function GET(req: Request) {
  // ?debug=1 returns the raw DataForSEO transactions response so we can
  // see the shape and tighten the parser when the indicator shows "—".
  // Auth comes from the Supabase middleware that already protects
  // /api/* — no extra gating needed.
  const url = new URL(req.url);
  if (url.searchParams.get("debug") === "1") {
    const raw = await getRawMonthlyTransactions();
    return NextResponse.json(raw, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const payload = await cachedFetch();
  return NextResponse.json(payload, {
    headers: {
      // Browsers shouldn't cache longer than the server's TTL — the
      // indicator's swr fetch handles its own staleness.
      "Cache-Control": "private, max-age=60",
    },
  });
}
