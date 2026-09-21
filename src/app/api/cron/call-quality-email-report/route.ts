import { NextResponse } from "next/server";
import { sendDailyCallQualityEmail } from "@/lib/call-quality-email";
import { yesterdayIso } from "@/lib/ppc-sync";
import { firstOfMonthIsoEastern } from "@/lib/date-utils";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Vercel cron entry. Fires daily at 11:40 UTC (7:40 AM ET during EDT),
// after both the PPC and LSA email reports (11:30/11:35) and their
// upstream CallRail syncs (11:10/11:20). Computes month-to-date and
// dispatches the PDF email via Resend. `?dry=1` returns the PDF inline
// for design iteration.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const from = url.searchParams.get("from") ?? firstOfMonthIsoEastern();
  const to = url.searchParams.get("to") ?? yesterdayIso();

  try {
    const result = await sendDailyCallQualityEmail({ from, to, dryRun });

    if (dryRun && "pdf" in result) {
      return new NextResponse(new Uint8Array(result.pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="call-quality-report-${to}.pdf"`,
        },
      });
    }

    return NextResponse.json({ from, to, ...result });
  } catch (err) {
    const message = (err as Error).message;
    console.error("[call-quality-email-report] failed:", message);
    return NextResponse.json(
      { error: message, from, to },
      { status: 500 },
    );
  }
}
