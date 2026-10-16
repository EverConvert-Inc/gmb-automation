import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __setPortalSqlForTests, portalQuery } from "./client";
import { makeFakeSql, type FakeCall } from "./fake-sql";
import {
  EVENTS_CONNECTION_OPTIONS,
  EVENT_RATE_PER_DAY,
  EVENT_RATE_PER_MINUTE,
  EVENT_WRITE_TIMEOUT_MS,
  MAX_PENDING_EVENT_WRITES,
  __pendingEventWritesForTests,
  __setEventSchedulerForTests,
  __setEventsSqlForTests,
  logPortalEvent,
  logPortalEvents,
} from "./events";
import type { PortalSession } from "./session";
import type { SessionFirmId } from "./types";

const FIRM = "11111111-1111-4111-8111-111111111111";
const OTHER_FIRM = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const LEAD = "44444444-4444-4444-8444-444444444444";
const session: PortalSession = { ok: true, userId: USER, firmId: FIRM as SessionFirmId, firmName: "Firm", email: "c@firm.com" };

let calls: FakeCall[] = [];
let tasks: (() => Promise<void>)[] = [];
let logged: string[] = [];

function useSql(respond: (c: FakeCall) => unknown[] | Promise<unknown[]> = () => []) {
  const fake = makeFakeSql(respond);
  calls = fake.calls;
  __setEventsSqlForTests(fake.sql);
}
async function runTasks() {
  const t = tasks;
  tasks = [];
  for (const task of t) await task();
}

beforeEach(() => {
  useSql();
  tasks = [];
  __setEventSchedulerForTests((task) => void tasks.push(task));
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(async () => {
  await runTasks();
  vi.useRealTimers();
  vi.restoreAllMocks();
  __setEventsSqlForTests(null);
  __setEventSchedulerForTests(null);
  __setPortalSqlForTests(null);
});

const view = { type: "page_view", meta: { page: "leads", range: "current" } } as const;

describe("connection", () => {
  it("has its own connection, named apart from the portal's, one at a time, no type lookup", () => {
    expect(EVENTS_CONNECTION_OPTIONS).toMatchObject({ max: 1, prepare: false, fetch_types: false });
    expect(EVENTS_CONNECTION_OPTIONS.connection.application_name).toBe("gmb-portal-events");
  });

  it("uses its own lock: a hung portal query does not hold up an event write", async () => {
    __setPortalSqlForTests(makeFakeSql(() => new Promise(() => {})).sql);
    void portalQuery("hung", (sql) => sql`select 1`).catch(() => {});
    logPortalEvent(session, view);
    await runTasks();
    expect(calls).toHaveLength(1);
  });
});

describe("never on the request path", () => {
  it("returns at once; nothing is written until the scheduled task runs", () => {
    expect(logPortalEvent(session, view)).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(tasks).toHaveLength(1);
  });

  it("an after() that throws (no request scope, no waitUntil) is swallowed", () => {
    __setEventSchedulerForTests(() => {
      throw new Error("`after` was called outside a request scope");
    });
    expect(() => logPortalEvent(session, view)).not.toThrow();
    expect(__pendingEventWritesForTests()).toBe(0);
  });

  it("a failing write is caught and logged without metadata or ids", async () => {
    useSql(() => {
      throw new Error(`boom ${USER} ${FIRM}`);
    });
    logPortalEvent(session, { type: "search_used", meta: { kind: "name" } });
    await expect(runTasks()).resolves.toBeUndefined();
    expect(logged).toEqual(["[portal events] search_used not logged: Error"]);
  });

  it("a write that never answers gives up at the timeout", async () => {
    vi.useFakeTimers();
    useSql(() => new Promise(() => {}));
    logPortalEvent(session, view);
    const run = runTasks();
    await vi.advanceTimersByTimeAsync(EVENT_WRITE_TIMEOUT_MS);
    await expect(run).resolves.toBeUndefined();
    expect(logged).toEqual(["[portal events] page_view not logged: EventWriteTimeout"]);
  });

  it("beyond the backlog cap, events are dropped instead of queued", () => {
    for (let i = 0; i < MAX_PENDING_EVENT_WRITES + 5; i++) logPortalEvent(session, view);
    expect(tasks).toHaveLength(MAX_PENDING_EVENT_WRITES);
    expect(__pendingEventWritesForTests()).toBe(MAX_PENDING_EVENT_WRITES);
  });
});

describe("firm and user come from the session only", () => {
  it("binds the session's firm and user", async () => {
    logPortalEvent(session, { type: "note_saved", leadId: LEAD, meta: {} });
    await runTasks();
    expect(calls[0].params).toEqual(expect.arrayContaining([FIRM, USER, "note_saved", LEAD, "{}"]));
  });

  it.each([
    ["a firm id on the event", { ...view, firmId: OTHER_FIRM }],
    ["a user id on the event", { ...view, authUserId: USER }],
    ["a firm id in metadata", { type: "page_view", meta: { page: "leads", range: "current", firm_id: OTHER_FIRM } }],
  ])("drops an event carrying %s", async (_, event) => {
    logPortalEvents(session, [event]);
    await runTasks();
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(logged)).not.toContain(OTHER_FIRM);
  });
});

describe("metadata holds nothing sensitive", () => {
  const SECRETS = ["John Smith", "555-123-4567", "john@example.com", "Called, wants a callback", "2026-08-01"];

  it.each([
    ["a search term", { type: "search_used", meta: { kind: "name", term: SECRETS[0] } }],
    ["a phone search", { type: "search_used", meta: { kind: "phone", query: SECRETS[1] } }],
    ["an email", { type: "status_filter_used", meta: { statuses: ["signed"], email: SECRETS[2] } }],
    ["note text", { type: "note_saved", leadId: LEAD, meta: { body: SECRETS[3] } }],
    ["typed dates", { type: "date_range_changed", meta: { kind: "custom", span_days: 3, from: SECRETS[4] } }],
    ["a free-text kind", { type: "search_used", meta: { kind: SECRETS[0] } }],
    ["a status that isn't one", { type: "status_filter_used", meta: { statuses: [SECRETS[0]] } }],
    ["a hand-made sign-in time", { type: "sign_in", meta: { signed_in_at: SECRETS[0] } }],
    ["an unknown type", { type: "ip_address", meta: { ip: "1.2.3.4" } }],
  ])("drops an event with %s, and stores nothing from it", async (_, event) => {
    logPortalEvents(session, [event]);
    await runTasks();
    expect(calls).toHaveLength(0);
    for (const s of [...SECRETS, "1.2.3.4"]) expect(logged.join("\n")).not.toContain(s);
  });

  it("valid events in a batch are kept when one is invalid", async () => {
    logPortalEvents(session, [view, { type: "search_used", meta: { kind: "name", term: "x" } }]);
    await runTasks();
    expect(calls).toHaveLength(1);
  });

  it("parameters are scalars; metadata is one JSON text value", async () => {
    logPortalEvents(session, [
      view,
      { type: "status_filter_used", meta: { statuses: ["signed", "pending"] } },
      { type: "date_range_changed", meta: { kind: "custom", span_days: 5 } },
      { type: "sign_in", meta: { signed_in_at: "2026-10-15T14:03:22.123456Z" } },
    ]);
    await runTasks();
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      for (const p of c.params) expect(p === null || ["string", "number"].includes(typeof p)).toBe(true);
      expect(c.text).not.toMatch(/\[\]|\bany\s*\(/i);
    }
    expect(calls[1].params).toContain(JSON.stringify({ statuses: ["signed", "pending"] }));
  });
});

describe("the INSERT", () => {
  it("is an insert-only statement into portal_events, gated by the per-minute and per-day limits", async () => {
    logPortalEvent(session, { type: "search_used", meta: { kind: "phone" } });
    await runTasks();
    const t = calls[0].text.replace(/\s+/g, " ");
    expect(t).toMatch(/^\s*insert into portal_events \(firm_id, auth_user_id, event_type, lead_id, metadata\) select /);
    expect(t).toContain("interval '1 minute'");
    expect(t).toContain("interval '1 day'");
    expect(calls[0].params).toEqual(expect.arrayContaining([EVENT_RATE_PER_MINUTE, EVENT_RATE_PER_DAY]));
    expect(t).not.toMatch(/\b(update|delete)\b/i);
    expect(t).not.toContain("not exists");
  });

  it("page views are deduped within the window; sign-ins once per Auth sign-in time", async () => {
    logPortalEvents(session, [view, { type: "sign_in", meta: { signed_in_at: "2026-10-15T14:03:22Z" } }]);
    await runTasks();
    expect(calls[0].text).toMatch(/not exists[\s\S]*event_type = 'page_view'[\s\S]*make_interval/);
    expect(calls[1].text).toMatch(/not exists[\s\S]*event_type = 'sign_in' and e\.metadata = \$\d+::jsonb\)/);
  });
});
