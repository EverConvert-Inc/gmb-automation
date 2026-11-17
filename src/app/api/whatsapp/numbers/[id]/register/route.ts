import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAdmin } from "@/lib/leads/admin-auth";
import { RegisterRefused, registerNumberForCloudApi } from "@/lib/whatsapp-inbox";

export const runtime = "nodejs";
export const maxDuration = 30;

// The pin travels only in this request's JSON body and onward to Meta. Nothing
// here logs the request, the parsed body, or any error that could contain it:
// the zod message describes the rule, not the value.
const Body = z.object({ pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits") }).strict();

// "Register for Cloud API" on /whatsapp/numbers. Admin-checked here as well
// as in the middleware, since it changes the number's state at Meta.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let pin: string;
  try {
    pin = Body.parse(await req.json()).pin;
  } catch {
    return NextResponse.json({ error: "PIN must be exactly 6 digits" }, { status: 400 });
  }

  try {
    return NextResponse.json(await registerNumberForCloudApi(id, pin));
  } catch (err) {
    if (err instanceof RegisterRefused) return NextResponse.json({ error: err.message }, { status: 409 });
    // Network/config failures before Meta answered. The message comes from
    // fetch or our own checks, never from the request body.
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
