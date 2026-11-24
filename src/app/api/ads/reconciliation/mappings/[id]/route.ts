import { NextResponse } from "next/server";
import {
  deleteMapping,
  ReconMappingUpdateBody,
  updateMapping,
} from "@/lib/queries-google-ads-reconciliation-mappings";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let input;
  try {
    input = ReconMappingUpdateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 400 });
  }
  try {
    const mapping = await updateMapping(id, input);
    if (!mapping) return NextResponse.json({ error: "mapping not found" }, { status: 404 });
    return NextResponse.json({ mapping });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteMapping(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
