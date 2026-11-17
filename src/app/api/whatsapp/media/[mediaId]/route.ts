import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { whatsappMessages } from "@/lib/db/schema";
import { downloadMedia, WhatsappApiError } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 30;

// Streams a message's photo/voice note/document from Meta. Admin-only via the
// middleware. Only ids we actually received are served, so this can't be used
// to fetch arbitrary Graph objects with our token. Meta keeps inbound media
// for a limited time, so old attachments eventually answer 404.
export async function GET(_req: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const msg = await db.query.whatsappMessages.findFirst({
    where: eq(whatsappMessages.mediaId, mediaId),
    columns: { mediaFilename: true },
  });
  if (!msg) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const media = await downloadMedia(mediaId);
    const headers: Record<string, string> = {
      "content-type": media.mimeType,
      "cache-control": "private, max-age=3600",
    };
    if (media.size) headers["content-length"] = String(media.size);
    if (msg.mediaFilename) {
      headers["content-disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(msg.mediaFilename)}`;
    }
    return new NextResponse(media.body, { status: 200, headers });
  } catch (err) {
    const status = err instanceof WhatsappApiError && err.status === 404 ? 404 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
