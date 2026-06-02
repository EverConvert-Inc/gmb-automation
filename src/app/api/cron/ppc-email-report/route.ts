import { NextResponse } from "next/server";
import { sendDailyPpcEmail } from "@/lib/ppc-email";
import { yesterdayIso } from "@/lib/ppc-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// First day of the current month in UTC (YYYY-MM-01).
function monthStartIso(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

// Vercel cron entry. Fires once a day at 07:00 UTC (after both PPC syncs
// have finished). Computes month-to-date and dispatches the PDF email via
// Resend. `?dry=1` returns the PDF inline for design iteration.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const from = url.searchParams.get("from") ?? monthStartIso();
  const to = url.searchParams.get("to") ?? yesterdayIso();

  try {
    const result = await sendDailyPpcEmail({ from, to, dryRun });

    if (dryRun && "pdf" in result) {
      return new NextResponse(new Uint8Array(result.pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="ppc-report-${to}.pdf"`,
        },
      });
    }

    return NextResponse.json({ from, to, ...result });
  } catch (err) {
    const message = (err as Error).message;
    console.error("[ppc-email-report] failed:", message);
    return NextResponse.json(
      { error: message, from, to },
      { status: 500 },
    );
  }
}
