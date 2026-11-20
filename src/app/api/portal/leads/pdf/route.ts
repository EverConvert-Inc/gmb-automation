import { NextResponse } from "next/server";
import { listVisibleLeadsCapped } from "@/lib/portal/db";
import { presetOf, rangeFromSearchParams } from "@/lib/portal/range";
import { requirePortalSession } from "@/lib/portal/session";
import type { ClientLabel } from "@/lib/portal/visibility";
import { formatPortalRange } from "@/app/(portal)/_components/format";
import { leadsPdfFilename, renderLeadsPdf } from "@/app/(portal)/_lib/leads-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const STATUSES: readonly ClientLabel[] = ["signed", "pending"];

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * GET /api/portal/leads/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD[&status=signed,pending]
 *
 * The leads page as a PDF. The firm comes from the session only; the range
 * goes through the same rangeFromSearchParams + listVisibleLeadsCapped as the
 * page, so the PDF can list exactly what the page lists and nothing more. A
 * refused range falls back to the current month, as the page does.
 */
export async function GET(req: Request) {
  const session = await requirePortalSession();
  if (!session.ok) {
    if (session.reason === "auth_unavailable") {
      return json({ error: "The sign-in service is temporarily unavailable." }, 503);
    }
    return session.reason === "not_signed_in" ? json({ error: "Not signed in." }, 401) : json({ error: "No access." }, 403);
  }

  const params = new URL(req.url).searchParams;
  const { range } = rangeFromSearchParams({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    month: params.get("month") ?? undefined,
  });
  // Anything not a known label is ignored; none (or all) means every status.
  const asked = new Set(
    params
      .getAll("status")
      .flatMap((v) => v.split(","))
      .map((v) => v.trim().toLowerCase()),
  );
  const statuses = STATUSES.filter((s) => asked.has(s));
  const filter = statuses.length === STATUSES.length ? [] : statuses;

  try {
    const { leads, reachedLimit } = await listVisibleLeadsCapped(session.firmId, range);
    const shown = filter.length ? leads.filter((l) => filter.includes(l.status)) : leads;
    const pdf = await renderLeadsPdf({
      firmName: session.firmName,
      rangeLabel: formatPortalRange(range, presetOf(range)),
      leads: shown,
      reachedLimit,
      statuses: filter,
      generatedAt: new Date(),
    });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${leadsPdfFilename(session.firmName, range.from, range.to)}"`,
      },
    });
  } catch (err) {
    // Logged without any lead data.
    console.error(`[portal pdf] failed: ${err instanceof Error ? err.name : "unknown"}`);
    return json({ error: "Could not build the PDF. Please try again." }, 500);
  }
}
