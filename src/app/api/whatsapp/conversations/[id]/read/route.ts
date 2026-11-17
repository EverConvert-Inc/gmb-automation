import { NextResponse } from "next/server";
import { markConversationRead } from "@/lib/whatsapp-inbox";

export const runtime = "nodejs";

// Called by the thread view when it is open, so unread counts clear.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await markConversationRead(id);
  return NextResponse.json({ ok: true });
}
