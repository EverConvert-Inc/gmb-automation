import { NextResponse } from "next/server";
import { getThread } from "@/lib/whatsapp-inbox";

export const runtime = "nodejs";

// One thread, for switching chats in the inbox without re-rendering the page.
// Admin-only via the middleware.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const thread = await getThread(id);
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(thread, { headers: { "cache-control": "no-store" } });
}
