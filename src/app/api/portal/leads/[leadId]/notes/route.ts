import { NextResponse } from "next/server";
import { z } from "zod";
import { toIsoDateEastern } from "@/lib/date-utils";
import { NOTE_MAX_LENGTH, addClientNote } from "@/lib/portal/db";
import { logPortalEvent } from "@/lib/portal/events";
import { requirePortalSession } from "@/lib/portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

// Exactly { body }. .strict() refuses every other key — a firm id, a user id,
// an author — so the firm and the author can only come from the session.
const NoteBody = z.object({ body: z.string() }).strict();

// A bound on what is read before parsing; the real limit (NOTE_MAX_LENGTH
// after trimming) is enforced by addClientNote.
const MAX_REQUEST_CHARS = NOTE_MAX_LENGTH * 4 + 1_000;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  // The route checks for itself; the middleware only decides who may reach
  // /api/portal at all.
  const session = await requirePortalSession();
  if (!session.ok) {
    if (session.reason === "auth_unavailable") {
      return json({ error: "The sign-in service is temporarily unavailable." }, 503);
    }
    return session.reason === "not_signed_in"
      ? json({ error: "Not signed in." }, 401)
      : json({ error: "No access." }, 403);
  }

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "Send the note as JSON: { body }." }, 400);
  }

  const raw = await req.text();
  if (raw.length > MAX_REQUEST_CHARS) {
    return json({ error: `A note can be at most ${NOTE_MAX_LENGTH} characters.` }, 400);
  }
  let parsed: z.infer<typeof NoteBody>;
  try {
    parsed = NoteBody.parse(JSON.parse(raw));
  } catch {
    return json({ error: "Send the note as JSON: { body }." }, 400);
  }

  const { leadId } = await params;

  try {
    const result = await addClientNote(session.firmId, session.userId, session.email, leadId, parsed.body);
    if (!result.ok) {
      return result.reason === "not_found"
        ? json({ error: "Lead not found." }, 404)
        : json({ error: `A note must be between 1 and ${NOTE_MAX_LENGTH} characters.` }, 400);
    }
    // After the response, never awaited; the lead id is the inserted row's.
    logPortalEvent(session, { type: "note_saved", leadId: result.note.leadId, meta: {} });
    return json(
      {
        note: {
          id: result.note.id,
          body: parsed.body.trim(),
          author: "client",
          date: toIsoDateEastern(result.note.createdAt),
        },
      },
      201,
    );
  } catch (err) {
    // Logged without the note text; the client gets nothing specific.
    console.error(`[portal notes] save failed: ${err instanceof Error ? err.name : "unknown"}`);
    return json({ error: "Could not save the note. Please try again." }, 500);
  }
}
