import { NextResponse } from "next/server";
import { BrowserEventBatchSchema } from "@/lib/portal/event-schema";
import { MAX_EVENTS_BODY_CHARS, overEventRateLimit } from "@/lib/portal/event-rate-limit";
import { logPortalEvents } from "@/lib/portal/events";
import { requirePortalSession } from "@/lib/portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Browser-reported portal events: date range changes, status filter use and
 * search use only. The firm and the user come from the session; the body is
 * exactly { events: [...] } with no ids of any kind. Answers 202 at once —
 * the write happens after the response, and its failure is never visible.
 */
export async function POST(req: Request) {
  const session = await requirePortalSession();
  if (!session.ok) {
    if (session.reason === "auth_unavailable") {
      return json({ error: "The sign-in service is temporarily unavailable." }, 503);
    }
    return session.reason === "not_signed_in" ? json({ error: "Not signed in." }, 401) : json({ error: "No access." }, 403);
  }

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "Send JSON." }, 400);
  }
  const raw = await req.text();
  if (raw.length > MAX_EVENTS_BODY_CHARS) return json({ error: "Too large." }, 400);

  let batch;
  try {
    batch = BrowserEventBatchSchema.parse(JSON.parse(raw));
  } catch {
    return json({ error: "Invalid events." }, 400);
  }

  if (overEventRateLimit(session.userId, batch.events.length)) {
    return json({ error: "Too many events." }, 429);
  }

  logPortalEvents(session, batch.events);
  return json({ accepted: batch.events.length }, 202);
}
