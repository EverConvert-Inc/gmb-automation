import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ReplyRefused, sendReply } from "@/lib/whatsapp-inbox";
import { WhatsappApiError } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 30;

// WhatsApp's own text limit is 4096 characters.
const Body = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "message is empty").max(4096),
});

// Reply from the inbox. Admin-only via the middleware like every internal API.
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  let email: string | null = null;
  try {
    const { data } = await (await getSupabaseServerClient()).auth.getUser();
    email = data.user?.email ?? null;
  } catch {
    // Attribution only; never block a reply on it.
  }
  try {
    const message = await sendReply(parsed.conversationId, parsed.body, email);
    return NextResponse.json({ ok: true, id: message?.id ?? null });
  } catch (err) {
    if (err instanceof ReplyRefused) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof WhatsappApiError) {
      return NextResponse.json({ error: `WhatsApp: ${err.message}` }, { status: 502 });
    }
    console.error("[whatsapp-send] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
