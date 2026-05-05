import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/places";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
  try {
    const results = await searchPlaces(q);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
