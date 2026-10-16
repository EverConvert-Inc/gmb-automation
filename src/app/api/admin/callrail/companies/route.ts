import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leadFirmCallrailCompanies, leadFirms } from "@/lib/db/schema";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import { listTrackerCompanies, type TrackerCompany } from "@/lib/leads/callrail-client";
import { assertRowShape } from "@/lib/leads/row-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The CallRail companies in the account, for the firm page's company picker.
 * Staff-only. The page calls this only when someone opens the picker.
 *
 * - Time limit: CALLRAIL_TIMEOUT_MS for the whole listing, retries included.
 * - Cache: the CallRail list is kept per instance for CACHE_TTL_MS, so
 *   reopening the picker does not hit CallRail again; ?refresh=1 skips it.
 *   Which firm each company is mapped to is read fresh every time.
 */
const CALLRAIL_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60_000;
const NO_STORE = { "Cache-Control": "private, no-store" };

let cache: { at: number; companies: TrackerCompany[] } | null = null;

type PickerCompany = TrackerCompany & { mappedTo: { firmId: string; firmName: string } | null };

export async function GET(req: Request) {
  const denied = await requireAdminRoute();
  if (denied) return denied;

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const now = Date.now();
  let cached = false;
  let companies: TrackerCompany[];

  if (!refresh && cache && now - cache.at < CACHE_TTL_MS) {
    companies = cache.companies;
    cached = true;
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALLRAIL_TIMEOUT_MS);
    try {
      companies = await listTrackerCompanies({ signal: controller.signal, maxAttempts: 2 });
      cache = { at: now, companies };
    } catch (err) {
      const timedOut = controller.signal.aborted;
      console.error(`[callrail companies] ${timedOut ? "timed out" : err instanceof Error ? err.name : "failed"}`);
      return NextResponse.json(
        {
          error: timedOut
            ? `CallRail did not answer within ${CALLRAIL_TIMEOUT_MS / 1000}s. Try again, or paste the company id.`
            : "Could not load companies from CallRail. Try again, or paste the company id.",
        },
        { status: timedOut ? 504 : 502, headers: NO_STORE },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Which firm already owns each company (callrail_company_id is UNIQUE).
  const mappings = await db
    .select({
      callrailCompanyId: leadFirmCallrailCompanies.callrailCompanyId,
      firmId: leadFirms.id,
      firmName: leadFirms.name,
    })
    .from(leadFirmCallrailCompanies)
    .innerJoin(leadFirms, eq(leadFirms.id, leadFirmCallrailCompanies.firmId))
    .orderBy(asc(leadFirmCallrailCompanies.callrailCompanyId));
  assertRowShape("callrail companies: mappings", mappings, {
    callrailCompanyId: "string",
    firmId: "string",
    firmName: "string",
  });
  const byCompany = new Map(mappings.map((m) => [m.callrailCompanyId, { firmId: m.firmId, firmName: m.firmName }]));

  const result: PickerCompany[] = [...companies]
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
    .map((c) => ({ ...c, mappedTo: byCompany.get(c.id) ?? null }));

  return NextResponse.json(
    { companies: result, cached, fetchedAt: new Date(cache?.at ?? now).toISOString() },
    { headers: NO_STORE },
  );
}
