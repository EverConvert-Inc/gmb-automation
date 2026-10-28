import { NextResponse } from "next/server";
import { z } from "zod";
import { like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { redditClients } from "@/lib/db/schema";

export const runtime = "nodejs";

const CreateBody = z.object({ name: z.string().trim().min(1) }).strict();

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "client"
  );
}

// Unlike the PPC/LSA new-client forms, the slug isn't asked for: Reddit
// clients have no per-client page, so it's only a stable unique key. A
// clashing slug gets a numeric suffix.
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const base = slugify(parsed.name);
  const taken = new Set(
    (
      await db
        .select({ slug: redditClients.slug })
        .from(redditClients)
        .where(like(redditClients.slug, `${base}%`))
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  const [row] = await db.insert(redditClients).values({ name: parsed.name, slug }).returning();
  return NextResponse.json(row, { status: 201 });
}
