import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { clients } from "@/lib/db/schema";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  try {
    const [client] = await db
      .insert(clients)
      .values({ name: parsed.name, slug: parsed.slug, status: "active" })
      .returning();
    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
