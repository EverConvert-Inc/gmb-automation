import { NextResponse } from "next/server";
import {
  createMapping,
  getMappingsForClient,
  ReconMappingCreateBody,
} from "@/lib/queries-google-ads-reconciliation-mappings";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? "";
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ mappings: await getMappingsForClient(clientId) });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let input;
  try {
    input = ReconMappingCreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 400 });
  }
  try {
    return NextResponse.json({ mapping: await createMapping(input) });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
