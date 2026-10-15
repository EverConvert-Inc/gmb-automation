import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { leads } from "@/lib/db/schema";
import { adminQueueCondition } from "./queries-admin";

// Compiled only — the client never connects.
const db = drizzle(postgres("postgres://x@127.0.0.1:1/x", { max: 1 }), { schema });

describe("the admin queue condition", () => {
  const { sql: text } = db.select({ id: leads.id }).from(leads).where(adminQueueCondition()).toSQL();

  // A duplicate no longer sets needs_review, so without this the queue would
  // silently stop showing duplicates at all.
  it("reads possible_duplicate_of directly", () => {
    expect(text).toContain('"possible_duplicate_of" is not null');
  });

  it("still covers everything hidden from clients", () => {
    expect(text).toContain('"needs_review" = $');
    expect(text).toContain('"firm_id" is null');
    expect(text).toContain('"parse_failed" = $');
  });
});
