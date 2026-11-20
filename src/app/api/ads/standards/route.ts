import { NextResponse } from "next/server";
import { createStandard, getStandards, StandardBody } from "@/lib/queries-google-ads-standards";
import { stringifyError } from "@/lib/leads/sync";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ standards: await getStandards() });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let input;
  try {
    input = StandardBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 400 });
  }
  try {
    return NextResponse.json({ standard: await createStandard(input) });
  } catch (err) {
    return NextResponse.json({ error: stringifyError(err) }, { status: 500 });
  }
}
