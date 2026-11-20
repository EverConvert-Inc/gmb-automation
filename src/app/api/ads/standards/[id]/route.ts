import { NextResponse } from "next/server";
import { deleteStandard, updateStandard, StandardBody } from "@/lib/queries-google-ads-standards";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let input;
  try {
    input = StandardBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 400 });
  }
  try {
    const standard = await updateStandard(id, input);
    if (!standard) return NextResponse.json({ error: "standard not found" }, { status: 404 });
    return NextResponse.json({ standard });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteStandard(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
