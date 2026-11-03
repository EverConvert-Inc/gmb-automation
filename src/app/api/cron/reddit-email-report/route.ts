import { NextResponse } from "next/server";
import { yesterdayIsoEastern } from "@/lib/date-utils";
import { sendDailyRedditEmail } from "@/lib/reddit-email";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Vercel cron entry. Fires daily at 11:45 UTC (7:45 AM ET during EDT,
// 6:45 AM ET during EST), after reddit-ads-sync (11:25 UTC).
// Month to date through yesterday, Eastern. The month is taken from
// yesterday's date, so the run on the 1st sends the whole previous month
// rather than an empty window. `?dry=1` returns the PDF inline.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const to = url.searchParams.get("to") ?? yesterdayIsoEastern();
  const from = url.searchParams.get("from") ?? `${to.slice(0, 8)}01`;

  try {
    const result = await sendDailyRedditEmail({ from, to, dryRun });

    if (dryRun && "pdf" in result) {
      return new NextResponse(new Uint8Array(result.pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="reddit-spend-report-${to}.pdf"`,
        },
      });
    }

    return NextResponse.json({ from, to, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[reddit-email-report] failed:", message);
    return NextResponse.json({ error: message, from, to }, { status: 500 });
  }
}
