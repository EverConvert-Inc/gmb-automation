import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

import { __setPortalSqlForTests } from "./client";
import { makeFakeSql, type FakeCall } from "./fake-sql";
import { __resetEventRateLimitForTests, ROUTE_EVENTS_PER_MINUTE } from "./event-rate-limit";
import { __resetEventsForTests, __setEventSchedulerForTests, __setEventsSqlForTests } from "./events";
import { POST } from "@/app/api/portal/events/route";

const FIRM = "11111111-1111-4111-8111-111111111111";
const OTHER_FIRM = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const USER_2 = "55555555-5555-4555-8555-555555555555";

let membership = { member_active: true, firm_active: true };
let eventCalls: FakeCall[] = [];
let tasks: (() => Promise<void>)[] = [];

function signedIn(id: string, appMetadata: unknown) {
  getUser.mockResolvedValue({ data: { user: { id, email: "c@firm.com", app_metadata: appMetadata } }, error: null });
}

beforeEach(() => {
  __resetEventsForTests();
  getUser.mockReset();
  membership = { member_active: true, firm_active: true };
  __setPortalSqlForTests(
    makeFakeSql((c) =>
      c.text.includes("from lead_firm_users")
        ? [{ firm_id: FIRM, auth_user_id: c.params[0], firm_name: "Firm", ...membership }]
        : [],
    ).sql,
  );
  const fake = makeFakeSql(() => []);
  eventCalls = fake.calls;
  __setEventsSqlForTests(fake.sql);
  tasks = [];
  __setEventSchedulerForTests((t) => void tasks.push(t));
  __resetEventRateLimitForTests();
  signedIn(USER, { role: "client" });
});
afterEach(() => {
  vi.useRealTimers();
  __setPortalSqlForTests(null);
  __setEventsSqlForTests(null);
  __setEventSchedulerForTests(null);
});

function post(body: unknown, { raw = false, contentType = "application/json" } = {}) {
  return POST(
    new Request("http://x/api/portal/events", {
      method: "POST",
      headers: { "content-type": contentType },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}
async function runTasks() {
  for (const t of tasks.splice(0)) await t();
}

const search = { type: "search_used", meta: { kind: "name" } };

describe("who may post", () => {
  it.each([
    ["signed out", () => getUser.mockResolvedValue({ data: { user: null }, error: null }), 401],
    ["staff", () => signedIn(USER, { role: "admin" }), 403],
    ["untagged", () => signedIn(USER, {}), 403],
    ["an inactive membership", () => (membership = { member_active: false, firm_active: true }), 403],
    ["an inactive firm", () => (membership = { member_active: true, firm_active: false }), 403],
  ] as const)("%s → %i, nothing scheduled", async (_, setup, status) => {
    setup();
    expect((await post({ events: [search] })).status).toBe(status);
    expect(tasks).toHaveLength(0);
  });

  it("a hung Auth call → 503 at 10s", async () => {
    vi.useFakeTimers();
    getUser.mockReturnValue(new Promise(() => {}));
    const pending = post({ events: [search] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(503);
    expect(tasks).toHaveLength(0);
  });
});

describe("a valid batch", () => {
  it("answers 202 before anything is written, then writes for the session's firm and user", async () => {
    const res = await post({
      events: [
        search,
        { type: "status_filter_used", meta: { statuses: ["signed"] } },
        { type: "date_range_changed", meta: { kind: "preset_previous" } },
      ],
    });
    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(eventCalls).toHaveLength(0); // the response came first
    await runTasks();
    expect(eventCalls).toHaveLength(3);
    for (const c of eventCalls) {
      expect(c.params).toContain(FIRM);
      expect(c.params).toContain(USER);
      expect(c.params).not.toContain(OTHER_FIRM);
    }
  });
});

describe("rejected bodies", () => {
  it.each([
    ["a server-only type: sign_in", { events: [{ type: "sign_in", meta: { signed_in_at: "2026-10-15T14:03:22Z" } }] }],
    ["a server-only type: page_view", { events: [{ type: "page_view", meta: { page: "leads", range: "current" } }] }],
    ["a server-only type: note_saved", { events: [{ type: "note_saved", leadId: "44444444-4444-4444-8444-444444444444", meta: {} }] }],
    ["a firm id at the top", { events: [search], firmId: OTHER_FIRM }],
    ["a firm id on an event", { events: [{ ...search, firmId: OTHER_FIRM }] }],
    ["a user id in metadata", { events: [{ type: "search_used", meta: { kind: "name", userId: USER_2 } }] }],
    ["a search term", { events: [{ type: "search_used", meta: { kind: "name", term: "john" } }] }],
    ["typed dates", { events: [{ type: "date_range_changed", meta: { kind: "custom", span_days: 3, from: "2026-08-01" } }] }],
    ["span_days out of range", { events: [{ type: "date_range_changed", meta: { kind: "custom", span_days: 400 } }] }],
    ["span_days on a preset", { events: [{ type: "date_range_changed", meta: { kind: "preset_current", span_days: 31 } }] }],
    ["a custom range without its length", { events: [{ type: "date_range_changed", meta: { kind: "custom" } }] }],
    ["duplicate statuses", { events: [{ type: "status_filter_used", meta: { statuses: ["signed", "signed"] } }] }],
    ["no events", { events: [] }],
    ["more than 10 events", { events: Array.from({ length: 11 }, () => search) }],
    ["not an object", [search]],
    ["a bare event", search],
  ])("%s → 400, nothing scheduled", async (_, body) => {
    expect((await post(body)).status).toBe(400);
    expect(tasks).toHaveLength(0);
  });

  it.each([
    ["malformed JSON", '{"events": [', "application/json"],
    ["a form post", "events=x", "application/x-www-form-urlencoded"],
    ["plain text", "{}", "text/plain"],
    ["an oversized body", JSON.stringify({ events: [search], pad: "x".repeat(3000) }), "application/json"],
  ])("%s → 400", async (_, raw, contentType) => {
    expect((await post(raw, { raw: true, contentType })).status).toBe(400);
    expect(tasks).toHaveLength(0);
  });
});

describe("rate limit", () => {
  it(`allows ${ROUTE_EVENTS_PER_MINUTE} events a minute per user, then 429; another user is unaffected`, async () => {
    for (let i = 0; i < ROUTE_EVENTS_PER_MINUTE / 10; i++) {
      expect((await post({ events: Array.from({ length: 10 }, () => search) })).status).toBe(202);
    }
    expect((await post({ events: [search] })).status).toBe(429);
    signedIn(USER_2, { role: "client" });
    expect((await post({ events: [search] })).status).toBe(202);
  });
});
