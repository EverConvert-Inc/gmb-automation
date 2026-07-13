import { NextResponse } from "next/server";
import { z } from "zod";
import { sendDailyLsaEmail } from "@/lib/lsa-email";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

// Operator-triggered send (button on /lsa). Same orchestration as the
// daily cron, but the window is whatever the operator currently has
// selected in the date filter. Auth comes from the Supabase middleware —
// no CRON_SECRET exposed to the browser.
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }

  try {
    const result = await sendDailyLsaEmail({
      from: parsed.from,
      to: parsed.to,
    });
    return NextResponse.json({ from: parsed.from, to: parsed.to, ...result });
  } catch (err) {
    const message = (err as Error).message;
    console.error("[lsa/send-report] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
