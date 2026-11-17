import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/leads/admin-auth";
import { deleteConversation, getThread } from "@/lib/whatsapp-inbox";

export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

// One thread, for switching chats in the inbox without re-rendering the page.
// Admin-only via the middleware.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const thread = await getThread(id);
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(thread, { headers: { "cache-control": "no-store" } });
}

// "Delete chat" from the inbox's context menu. Permanent on our side only;
// admin-checked here as well as in the middleware since it destroys data.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!(await deleteConversation(id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
