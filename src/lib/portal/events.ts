import "server-only";

// The client portal's activity log writer.
//
// Rules this file exists to keep:
//  - Logging never breaks or slows the portal. Writes are scheduled with
//    Next's after(), so they run once the response has gone; nothing here is
//    awaited on the request path, every error is caught, and each write is
//    capped at EVENT_WRITE_TIMEOUT_MS.
//  - The firm and the user come ONLY from the PortalSession, never from the
//    event. An event with any extra key is invalid and dropped (see
//    event-schema.ts).
//  - Its OWN connection and its OWN one-query-at-a-time lock. Sharing the
//    portal's lock would let a slow log write delay another user's page on the
//    same instance; a second connection keeps the "never pipeline onto a busy
//    connection" property without that coupling.
//  - Parameters are scalars only; metadata travels as one JSON text value.

import { after } from "next/server";
import postgres from "postgres";
import { PortalEventSchema, type PortalEventInput } from "./event-schema";
import type { PortalSession } from "./session";

export const EVENT_WRITE_TIMEOUT_MS = 3_000;
/** Pending writes per instance; beyond this, events are dropped, never queued. */
export const MAX_PENDING_EVENT_WRITES = 50;
export const EVENT_RATE_PER_MINUTE = 60;
export const EVENT_RATE_PER_DAY = 2_000;
/** A repeat page view (e.g. the refresh after saving a note) within this window is not logged again. */
export const PAGE_VIEW_DEDUPE_MINUTES = 30;

export const EVENTS_CONNECTION_OPTIONS = {
  max: 1,
  prepare: false,
  fetch_types: false,
  idle_timeout: 20,
  connect_timeout: 5,
  connection: { application_name: "gmb-portal-events" },
} as const;

type Sql = postgres.Sql;

let client: Sql | null = null;
let testSql: Sql | null = null;
let schedule: (task: () => Promise<void>) => void = (task) => after(task);
let pending = 0;

function getSql(): Sql {
  if (testSql) return testSql;
  if (!client) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set");
    client = postgres(url, { ...EVENTS_CONNECTION_OPTIONS, connection: { ...EVENTS_CONNECTION_OPTIONS.connection } });
  }
  return client;
}

async function resetClient(): Promise<void> {
  const old = client;
  client = null;
  if (old) await old.end({ timeout: 0 }).catch(() => {});
}

/** Test seams only. */
export function __setEventsSqlForTests(sql: unknown): void {
  testSql = sql as Sql | null;
}
export function __setEventSchedulerForTests(fn: ((task: () => Promise<void>) => void) | null): void {
  schedule = fn ?? ((task) => after(task));
}
export function __pendingEventWritesForTests(): number {
  return pending;
}
/** Test seam only: a fresh lock and backlog; writes scheduled before this are skipped. */
export function __resetEventsForTests(): void {
  generation += 1;
  tail = Promise.resolve();
  pending = 0;
}

// Bumped only by the test reset, so a write left over from an earlier test
// never runs against the next test's database.
let generation = 0;

// The events connection's own lock — deliberately NOT client.ts's.
let tail: Promise<void> = Promise.resolve();
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

class EventWriteTimeout extends Error {
  constructor() {
    super("event write timed out");
    this.name = "EventWriteTimeout";
  }
}

/** One INSERT … SELECT: written only under the rate limits, and once per dedupe window where one applies. */
function insertEvent(sql: Sql, firmId: string, userId: string, event: PortalEventInput) {
  const leadId = event.type === "note_saved" ? event.leadId : null;
  const meta = JSON.stringify(event.meta);

  const dedupe =
    event.type === "page_view"
      ? sql`and not exists (
          select 1 from portal_events e
          where e.firm_id = ${firmId}::uuid and e.auth_user_id = ${userId}::uuid
            and e.event_type = 'page_view' and e.metadata = ${meta}::jsonb
            and e.created_at > now() - make_interval(mins => ${PAGE_VIEW_DEDUPE_MINUTES}::int))`
      : event.type === "sign_in"
        ? sql`and not exists (
          select 1 from portal_events e
          where e.firm_id = ${firmId}::uuid and e.auth_user_id = ${userId}::uuid
            and e.event_type = 'sign_in' and e.metadata = ${meta}::jsonb)`
        : sql``;

  return sql`
    insert into portal_events (firm_id, auth_user_id, event_type, lead_id, metadata)
    select ${firmId}::uuid, ${userId}::uuid, ${event.type}::text, ${leadId}::uuid, ${meta}::jsonb
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
}

async function writeOne(firmId: string, userId: string, event: PortalEventInput, gen: number): Promise<void> {
  await exclusive(async () => {
    if (gen !== generation) return;
    const sql = getSql();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pendingWrite = Promise.resolve(insertEvent(sql, firmId, userId, event));
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EventWriteTimeout()), EVENT_WRITE_TIMEOUT_MS);
    });
    try {
      await Promise.race([pendingWrite, timeout]);
    } catch (err) {
      if (err instanceof EventWriteTimeout) {
        pendingWrite.catch(() => {});
        // The stuck write may still hold the one connection; never queue the
        // next one behind it.
        await resetClient();
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Logged without metadata, ids or anything the user typed: the type and the error's name only. */
function report(type: string, err: unknown) {
  const name = err instanceof Error ? err.name : typeof err;
  console.error(`[portal events] ${type} not logged: ${name}`);
}

/**
 * Records events for the session's firm and user, after the response.
 * Returns immediately; never throws; never awaited by the caller. Invalid
 * events are dropped.
 */
export function logPortalEvents(session: PortalSession, events: readonly unknown[]): void {
  try {
    const firmId = session.firmId as string;
    const userId = session.userId;
    const valid: PortalEventInput[] = [];
    for (const e of events) {
      const parsed = PortalEventSchema.safeParse(e);
      if (parsed.success) valid.push(parsed.data);
      else report("invalid event", parsed.error);
    }
    if (valid.length === 0) return;
    if (pending >= MAX_PENDING_EVENT_WRITES) {
      report(valid[0].type, new Error("backlog full"));
      return;
    }
    pending += 1;
    const gen = generation;
    const task = async () => {
      try {
        for (const event of valid) {
          try {
            await writeOne(firmId, userId, event, gen);
          } catch (err) {
            report(event.type, err);
          }
        }
      } finally {
        pending -= 1;
      }
    };
    try {
      schedule(task);
    } catch (err) {
      // after() throws outside a request scope or without waitUntil.
      pending -= 1;
      report(valid[0].type, err);
    }
  } catch (err) {
    report("event", err);
  }
}

export function logPortalEvent(session: PortalSession, event: PortalEventInput): void {
  logPortalEvents(session, [event]);
}
