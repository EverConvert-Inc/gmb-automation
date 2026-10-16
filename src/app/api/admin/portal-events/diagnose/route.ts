// TEMPORARY DIAGNOSTIC — DELETE AFTER USE.
//
// Answers one question: why portal activity events are not landing in
// portal_events. Staff-only (requireAdminRoute), POST only, NOT registered in
// vercel.json, and it changes no portal file.
//
// It does one test INSERT inside a transaction that is always rolled back,
// with placeholder firm and user ids (all zeros), so it never leaves a row
// and never touches a leads table. Its response carries no credentials and no
// lead data.
//
// The test INSERT is the writer's own insertEvent() for a page_view (dedupe
// included), run on its own short-lived connection with the writer's
// exported connection options.

import { NextResponse, after } from "next/server";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import { EVENTS_CONNECTION_OPTIONS, __pendingEventWritesForTests, insertEvent } from "@/lib/portal/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
const TEST_TIMEOUT_MS = 5_000;

class Rollback extends Error {}

/** Host and port only — never the user, password or database name. */
function databaseTarget(url: string | undefined) {
  if (!url) return { set: false as const };
  try {
    const u = new URL(url);
    return { set: true as const, host: u.hostname, port: u.port || "5432" };
  } catch {
    return { set: true as const, host: "unparseable", port: "unparseable" };
  }
}

type TestWrite =
  | { ok: true; rowsInserted: number; rolledBack: true }
  | { ok: false; name: string; code: string | null; message: string; constraint: string | null };

async function testWrite(url: string): Promise<TestWrite> {
  const sql = postgres(url, {
    ...EVENTS_CONNECTION_OPTIONS,
    connection: { application_name: "gmb-portal-events-diagnose" },
  });
  let rowsInserted = -1;
  const attempt = (async (): Promise<TestWrite> => {
    try {
      await sql.begin(async (tx) => {
        // The writer's own SQL (insertEvent), for a page_view.
        const result = await insertEvent(tx as unknown as postgres.Sql, PLACEHOLDER_ID, PLACEHOLDER_ID, {
          type: "page_view",
          meta: { page: "leads", range: "current" },
        });
        rowsInserted = result.count;
        throw new Rollback(); // never commit
      });
      return { ok: false, name: "Error", code: null, message: "transaction committed unexpectedly", constraint: null };
    } catch (err) {
      if (err instanceof Rollback) return { ok: true, rowsInserted, rolledBack: true };
      const e = err as { name?: string; code?: string; message?: string; constraint_name?: string };
      return {
        ok: false,
        name: e?.name ?? typeof err,
        code: e?.code ?? null,
        message: e?.message ?? String(err),
        constraint: e?.constraint_name ?? null,
      };
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TestWrite>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, name: "Timeout", code: null, message: `no answer within ${TEST_TIMEOUT_MS}ms`, constraint: null }),
      TEST_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
    // Bounded: a cleanup that hangs must not hold this request open.
    await Promise.race([sql.end({ timeout: 1 }).catch(() => {}), new Promise((r) => setTimeout(r, 2_000))]);
  }
}

export async function POST() {
  const denied = await requireAdminRoute();
  if (denied) return denied;

  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

  // after() probe: throws at once if waitUntil is unavailable; otherwise the
  // callback prints the token once this response has been sent.
  const token = randomUUID();
  let afterScheduled: { ok: true } | { ok: false; error: string };
  try {
    after(() => {
      console.log(`[portal events diagnose] after() ran ${token}`);
    });
    afterScheduled = { ok: true };
  } catch (err) {
    afterScheduled = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const write: TestWrite | { ok: false; name: string; code: null; message: string; constraint: null } = url
    ? await testWrite(url)
    : { ok: false, name: "Config", code: null, message: "DATABASE_URL (or POSTGRES_URL) is not set", constraint: null };

  return NextResponse.json(
    {
      deployment: {
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        env: process.env.VERCEL_ENV ?? null,
        region: process.env.VERCEL_REGION ?? null,
      },
      database: databaseTarget(url),
      after: { scheduled: afterScheduled, probeToken: token, searchLogsFor: `[portal events diagnose] after() ran ${token}` },
      writer: {
        // Pending writes on THIS instance. The events lock's state is private
        // to events.ts and is not observable without changing that file; a
        // pending count that stays above 0 between calls means writes are stuck.
        pendingWritesOnThisInstance: __pendingEventWritesForTests(),
        lockState: "not observable from here",
      },
      testWrite: write,
    },
    { headers: NO_STORE },
  );
}
