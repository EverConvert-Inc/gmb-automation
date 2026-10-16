// Pins the portal connection's options, and proves the portal never sends an
// array parameter — the condition that makes fetch_types: false safe.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

import { PORTAL_CONNECTION_OPTIONS, __setPortalSqlForTests } from "./client";
import { makeFakeSql, type FakeCall } from "./fake-sql";
import { addClientNote, listVisibleLeads } from "./db";
import { requirePortalSession } from "./session";
import type { SessionFirmId } from "./types";

const FIRM = "11111111-1111-4111-8111-111111111111" as SessionFirmId;
const USER = "33333333-3333-4333-8333-333333333333";
const LEAD = "44444444-4444-4444-8444-444444444444";

describe("portal connection options", () => {
  it("skips the per-connection type lookup and stays open 180s when idle", () => {
    expect(PORTAL_CONNECTION_OPTIONS.fetch_types).toBe(false);
    expect(PORTAL_CONNECTION_OPTIONS.idle_timeout).toBe(180);
  });

  it("keeps the isolation settings unchanged", () => {
    expect(PORTAL_CONNECTION_OPTIONS.max).toBe(1);
    expect(PORTAL_CONNECTION_OPTIONS.prepare).toBe(false);
    expect(PORTAL_CONNECTION_OPTIONS.connection.application_name).toBe("gmb-portal");
  });
});

describe("the portal never sends an array parameter", () => {
  let calls: FakeCall[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
    const fake = makeFakeSql((call) =>
      call.text.includes("from lead_firm_users")
        ? [{ firm_id: FIRM, auth_user_id: USER, member_active: true, firm_active: true, firm_name: "Firm" }]
        : [],
    );
    calls = fake.calls;
    __setPortalSqlForTests(fake.sql);
    getUser.mockResolvedValue({ data: { user: { id: USER, email: "c@firm.com", app_metadata: { role: "client" } } }, error: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    __setPortalSqlForTests(null);
  });

  const isScalar = (p: unknown) =>
    p === null || ["string", "number", "boolean", "bigint"].includes(typeof p) || p instanceof Date;

  it("across every portal query: session, both months of the list, and the note insert", async () => {
    await requirePortalSession();
    await listVisibleLeads(FIRM, "current");
    await listVisibleLeads(FIRM, "previous");
    await addClientNote(FIRM, USER, "c@firm.com", LEAD, "hello");
    await addClientNote(FIRM, USER, null, LEAD, "hello");
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      for (const p of c.params) {
        expect(Array.isArray(p), c.text.slice(0, 60)).toBe(false);
        expect(ArrayBuffer.isView(p)).toBe(false);
        expect(isScalar(p), `${typeof p} param in ${c.text.slice(0, 60)}`).toBe(true);
      }
      // No array-typed casts or array operators in the SQL either.
      expect(c.text).not.toMatch(/\[\]|\bany\s*\(|\barray\s*\[/i);
    }
  });

  // A new query site must be added to the run above, or this fails.
  it("those are the only files that run portal queries, and none use postgres.js array helpers", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : [p];
      });
    const src = join(process.cwd(), "src");
    const portalSources = [join(src, "lib", "portal"), join(src, "app", "(portal)"), join(src, "app", "api", "portal")]
      .flatMap(files)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith("fake-sql.ts"));
    const callers = portalSources
      .filter((f) => /\bportalQuery\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(src.length + 1))
      .sort();
    expect(callers).toEqual(["lib/portal/db.ts", "lib/portal/session.ts"]);
    for (const f of portalSources) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\bsql\.array\(|\bsql\(\s*\[/);
    }
  });
});
