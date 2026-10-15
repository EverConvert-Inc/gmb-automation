// The client portal's OWN database connection. Nothing here is shared with
// src/lib/db/client.ts, deliberately.
//
// Background: on the shared pool a query result was once delivered to the
// wrong query and rendered as wrong data. The portal must not depend on that
// pool's behaviour, so it runs with three properties of its own:
//
//  1. ONE connection (max: 1), and ONE query in flight at a time, enforced
//     here by a lock. postgres.js would otherwise pipeline a second query
//     onto the busy connection (postgres/src/index.js, the busy.shift() path),
//     which is exactly the pattern behind the earlier crosstalk. With the
//     lock, there is never a second query on the wire to be crossed with.
//
//  2. Rows keyed by COLUMN NAME (postgres.js tagged templates), not Drizzle's
//     positional mapping. A crossed result arrives with the wrong keys, and
//     the guards in guards.ts throw instead of rendering it.
//
//  3. A 15s limit enforced IN CODE. statement_timeout would normally do this
//     as a connection startup parameter, but Supabase documents that it
//     cannot be used with Supavisor in transaction mode. application_name IS
//     safe: postgres.js already sends it on every connection by default, and
//     the live app works.

import postgres from "postgres";

export const PORTAL_QUERY_TIMEOUT_MS = 15_000;

type Sql = postgres.Sql;

let client: Sql | null = null;
let testOverride: Sql | null = null;

function createClient(): Sql {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set");
  return postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    // Identifies portal queries in pg_stat_activity.
    connection: { application_name: "gmb-portal" },
  });
}

function getSql(): Sql {
  if (testOverride) return testOverride;
  if (!client) client = createClient();
  return client;
}

/** Test seam only. Pass null to restore the real client. */
export function __setPortalSqlForTests(sql: unknown): void {
  testOverride = sql as Sql | null;
}

// --------------------------------------------------------------------------
// The lock: one portal query at a time, per process
// --------------------------------------------------------------------------

let tail: Promise<void> = Promise.resolve();

/**
 * Runs `fn` only after every earlier call has settled, and always releases —
 * a thrown error, a rejection or a timeout cannot leave the lock held.
 */
export async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export class PortalQueryTimeout extends Error {
  constructor(readonly label: string, readonly ms: number) {
    super(`Portal query "${label}" did not answer within ${ms}ms.`);
    this.name = "PortalQueryTimeout";
  }
}

/**
 * Drops the connection. Called after a timeout: the slow query may still be
 * running on the one connection, and letting the next query onto it would
 * pipeline it behind the unfinished one — the very pattern this file exists
 * to rule out. A fresh client starts with an empty connection instead.
 */
async function resetClient(): Promise<void> {
  const old = client;
  client = null;
  if (old) await old.end({ timeout: 0 }).catch(() => {});
}

/**
 * The only way portal code reaches the database. Serialised by the lock and
 * bounded at `timeoutMs`.
 */
export function portalQuery<T>(
  label: string,
  run: (sql: Sql) => PromiseLike<T>,
  timeoutMs: number = PORTAL_QUERY_TIMEOUT_MS,
): Promise<T> {
  return runExclusive(async () => {
    const pending = Promise.resolve(run(getSql()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PortalQueryTimeout(label, timeoutMs)), timeoutMs);
    });
    try {
      return await Promise.race([pending, timeout]);
    } catch (err) {
      if (err instanceof PortalQueryTimeout) {
        pending.catch(() => {}); // its eventual answer is discarded, never delivered
        await resetClient();
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  });
}
