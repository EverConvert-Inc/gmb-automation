// The temporary step-0 text probe: who may call it, that it returns counts
// and key names only, and that its counts are right. Faked: CallRail (global
// fetch), the session and the mapped-company read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), rules: [] as { firmId: string; callrailCompanyId: string }[] }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ auth: { getUser: h.getUser } }),
}));
vi.mock("@/lib/leads/store", () => ({
  drizzleLeadStore: { loadRoutingRules: async () => ({ tagRules: [], companyRules: h.rules }) },
}));

import { GET } from "@/app/api/cron/lead-text-probe/route";
import { resetTrackerAccountIdCache } from "@/lib/leads/callrail-client";

// Values that must never appear in the response.
const SECRETS = ["Jane Customer", "+15551234567", "555-123-4567", "Please call me back", "Jane Doe, 555-111-2222, Signed", "CONVO-SECRET-1", "CONVO-SECRET-2"];

function fakeCallRail() {
  const conversations = [
    {
      id: "CONVO-SECRET-1",
      customer_name: "Jane Customer",
      customer_phone_number: "+15551234567",
      last_message_at: "2026-10-12T15:00:00.000-04:00",
      recent_messages: [{ content: "Please call me back", created_at: "2026-10-12T15:00:00.000-04:00" }],
    },
    {
      id: "CONVO-SECRET-2",
      customer_name: "Jane Customer",
      customer_phone_number: "+15551234567",
      last_message_at: "2026-10-14T10:00:00.000-04:00",
      recent_messages: [{ content: "x" }, { content: "y" }],
    },
  ];
  const details: Record<string, unknown> = {
    "CONVO-SECRET-1": {
      messages: [
        { content: "Please call me back", created_at: "2026-10-12T15:00:00.000-04:00", sms_thread: { id: 11, tags: [{ name: "Signed" }], notes: "Jane Doe, 555-111-2222, Signed" } },
      ],
    },
    "CONVO-SECRET-2": {
      messages: [
        { content: "a", created_at: "2026-09-20T10:00:00.000-04:00", sms_thread: { id: 21, tags: [{ name: "Pending" }], notes: "" } },
        { content: "b", created_at: "2026-10-01T10:00:00.000-04:00", sms_thread: { id: 21, tags: [{ name: "Pending" }], notes: "" } },
        { content: "c", created_at: "2026-10-14T10:00:00.000-04:00", sms_thread: { id: 22, tags: [{ name: "Duplicate" }], notes: null } },
      ],
    },
  };
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/v3/a.json") return Response.json({ accounts: [{ id: "ACC1" }] });
    if (url.pathname.endsWith("/text-messages.json")) return Response.json({ conversations, total_pages: 1 });
    const id = url.pathname.split("/").pop()!.replace(".json", "");
    return Response.json(details[id] ?? { messages: [] });
  });
}

let fetchMock: ReturnType<typeof fakeCallRail>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T15:00:00Z"));
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("CALLRAIL_API_KEY", "key");
  vi.stubEnv("CALLRAIL_ACCOUNT_ID", "");
  resetTrackerAccountIdCache();
  h.getUser.mockReset();
  h.getUser.mockResolvedValue({ data: { user: null } });
  h.rules = [{ firmId: "f1", callrailCompanyId: "COM1" }];
  fetchMock = fakeCallRail();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const call = (auth?: string) =>
  GET(new Request("https://x/api/cron/lead-text-probe", auth ? { headers: { authorization: auth } } : {}));

describe("access", () => {
  it("no secret and no session → 401, CallRail never called", async () => {
    expect((await call()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a wrong secret → 401", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
  });

  it("a client session → 403", async () => {
    h.getUser.mockResolvedValue({ data: { user: { email: "c@firm.com", app_metadata: { role: "client" } } } });
    expect((await call()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the CRON_SECRET bearer runs it", async () => {
    expect((await call("Bearer test-secret")).status).toBe(200);
  });

  it("a staff session runs it", async () => {
    h.getUser.mockResolvedValue({ data: { user: { email: "s@everconvert.com", app_metadata: { role: "admin" } } } });
    expect((await call()).status).toBe(200);
  });
});

describe("the report", () => {
  it("contains counts and key names only — no names, phones, notes, message text or conversation ids", async () => {
    const text = await (await call("Bearer test-secret")).text();
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(text).not.toContain("content\":\"");
  });

  it("reports the keys, thread ids, notes and the date-filter evidence", async () => {
    const body = await (await call("Bearer test-secret")).json();
    expect(body.window).toEqual({ from: "2026-10-01", to: "2026-10-19" });
    expect(body.keys.smsThreadKeys).toEqual(["id", "notes", "tags"]);
    expect(body.keys.conversationListKeys).toEqual(["customer_name", "customer_phone_number", "id", "last_message_at", "recent_messages"]);
    expect(body.threads).toMatchObject({
      seen: 3,
      withOwnId: 3,
      withNotesKey: 3,
      withNonEmptyNotes: 1,
      conversationsWithMultipleThreadIds: 1,
      withTrackedStatusTag: 2, // Signed, Pending; the Duplicate thread is not a status we track
    });
    expect(body.totals).toMatchObject({
      conversations: 2,
      detailFetched: 2,
      moreThan2Messages: 1,
      lastMessageInWindow: 2,
      lastMessageBeforeWindow: 0,
      firstMessageBeforeWindow: 1, // started Sep 20, active in October
    });
    expect(body.perCompany).toHaveLength(1);
    expect(body.perCompany[0].companyId).toBe("COM1");
  });

  it("only reads: every CallRail request is a GET to text-messages or the account lookup", async () => {
    await call("Bearer test-secret");
    for (const [input, init] of fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]) {
      expect(init?.method ?? "GET").toBe("GET");
      expect(String(input)).toMatch(/\/v3\/a(\.json|\/ACC1\/text-messages(\.json|\/[^/]+\.json))/);
    }
  });
});
