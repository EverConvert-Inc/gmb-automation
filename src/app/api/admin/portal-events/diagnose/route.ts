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
// insertEvent() and the writer's connection are private to
// src/lib/portal/events.ts, which this route must not change, so the INSERT
// below is a VERBATIM copy of insertEvent's SQL for a page_view (dedupe
// included), run on its own short-lived connection with the writer's exported
// connection options.

import { NextResponse, after } from "next/server";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import { EVENTS_CONNECTION_OPTIONS, __pendingEventWritesForTests } from "@/lib/portal/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
const TEST_TIMEOUT_MS = 5_000;
// Copied from events.ts so the SQL below is identical.
const EVENT_RATE_PER_MINUTE = 60;
const EVENT_RATE_PER_DAY = 2_000;
const PAGE_VIEW_DEDUPE_MINUTES = 30;

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
        const firmId = PLACEHOLDER_ID;
        const userId = PLACEHOLDER_ID;
        const meta = JSON.stringify({ page: "leads", range: "current" });
        const leadId = null;
        // ---- verbatim from events.ts insertEvent(), page_view branch ----
        const dedupe = tx`and not exists (
            select 1 from portal_events e
            where e.firm_id = ${firmId}::uuid and e.auth_user_id = ${userId}::uuid
              and e.event_type = 'page_view' and e.metadata = ${meta}::jsonb
              and e.created_at > now() - make_interval(mins => ${PAGE_VIEW_DEDUPE_MINUTES}::int))`;
        const result = await tx`
      insert into portal_events (firm_id, auth_user_id, event_type, lead_id, metadata)
      select ${firmId}::uuid, ${userId}::uuid, ${"page_view"}::text, ${leadId}::uuid, ${meta}::jsonb
      where (
          select count(*) from portal_events e
          where e.firm_id = ${firmId}::uuid and e.auth_user_id = ${userId}::uuid
            and e.created_at > now() - interval '1 minute'
        ) < ${EVENT_RATE_PER_MINUTE}::int
        and (
          select count(*) from portal_events e
          where e.firm_id = ${firmId}::uuid and e.auth_user_id = ${userId}::uuid
            and e.created_at > now() - interval '1 day'
        ) < ${EVENT_RATE_PER_DAY}::int
        ${dedupe}
    `;
        // -----------------------------------------------------------------
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
