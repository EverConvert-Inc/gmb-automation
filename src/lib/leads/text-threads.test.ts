// CallRail text conversations for the lead tracker: splitting a
// conversation into threads, the tracked-tag filter after the FULL history,
// first-message dates, the fetch itself, and that the PPC/LSA code is not
// involved.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALLRAIL_TRACKER_TEXT_FIELDS,
  fetchTextThreadsForCompany,
  hasTrackedTag,
  resetTrackerAccountIdCache,
  threadsOfConversation,
} from "./callrail-client";
import { normalizeText } from "./sync";
import { SOURCE_LABEL } from "@/components/leads/admin-leads-table";

const CONVO = {
  id: "CON1",
  customer_name: "Fallback Name",
  customer_phone_number: "+15550001111",
  tracker_name: "LSA - Texts",
  initial_tracker_id: "TRK9",
  last_message_at: "2026-10-14T10:00:00.000-04:00",
};
const msg = (created_at: string, threadId: number | null, tags: string[], notes: string | null = null) => ({
  created_at,
  sms_thread: threadId === null ? null : { id: threadId, tags: tags.map((name) => ({ name })), notes },
});

describe("threadsOfConversation", () => {
  it("one thread per sms_thread id, keyed conversation id + thread id", () => {
    const threads = threadsOfConversation(CONVO, [
      msg("2026-10-02T09:00:00.000-04:00", 11, ["Signed"], "Jane Doe, 555-123-4567"),
      msg("2026-10-14T10:00:00.000-04:00", 12, ["Duplicate"]),
    ]);
    expect(threads.map((t) => [t.id, t.threadId, t.tags])).toEqual([
      ["CON1:11", "11", ["Signed"]],
      ["CON1:12", "12", ["Duplicate"]],
    ]);
  });

  it("tags are the thread's own; the note is the thread's FIRST non-empty note", () => {
    const [t] = threadsOfConversation(CONVO, [
      msg("2026-10-02T09:00:00.000-04:00", 11, ["Pending"], null),
      msg("2026-10-03T09:00:00.000-04:00", 11, ["Pending"], "  "),
      msg("2026-10-04T09:00:00.000-04:00", 11, ["Signed"], "Jane Doe, 555-123-4567"),
      msg("2026-10-05T09:00:00.000-04:00", 11, ["Signed"], "a later, different note"),
    ]);
    expect(t.note).toBe("Jane Doe, 555-123-4567");
    expect(t.tags).toEqual(["Signed"]); // the thread's current tags (its newest message)
  });

  it("the date is the thread's FIRST message, however messages are ordered", () => {
    const [t] = threadsOfConversation(CONVO, [
      msg("2026-10-14T10:00:00.000-04:00", 11, ["Signed"]),
      msg("2026-09-28T08:00:00.000-04:00", 11, ["Signed"]),
    ]);
    expect(t.first_message_at).toBe("2026-09-28T08:00:00.000-04:00");
  });

  it("messages without a thread are ignored", () => {
    expect(threadsOfConversation(CONVO, [msg("2026-10-02T09:00:00.000-04:00", null, [])])).toEqual([]);
  });
});

describe("the tracked-tag filter", () => {
  it.each([
    [["Signed"], true],
    [["pending"], true],
    [["Opportunity"], true],
    [["Lost"], true], // a tracked status (hidden from clients later, but tracked)
    [["Duplicate"], false],
    [["Smith Law"], false],
    [[], false],
  ] as const)("%j → %s", (tags, expected) => {
    expect(hasTrackedTag(tags)).toBe(expected);
  });
});

describe("normalizeText", () => {
  it("is a text lead keyed by thread, dated by its first message, with the thread's tags and note", () => {
    const [t] = threadsOfConversation(CONVO, [
      msg("2026-09-28T08:00:00.000-04:00", 11, ["Signed", "Smith Law"], "Jane Doe, 555-123-4567"),
      msg("2026-10-14T10:00:00.000-04:00", 11, ["Signed", "Smith Law"]),
    ]);
    const lead = normalizeText(t, "COM1")!;
    expect(lead).toMatchObject({
      source: "text",
      callrailId: "CON1:11",
      callrailCompanyId: "COM1",
      tags: ["Signed", "Smith Law"],
      note: "Jane Doe, 555-123-4567",
      customerName: "Fallback Name",
      customerPhoneNumber: "+15550001111",
      rawSourceName: "LSA - Texts",
      rawTrackerId: "TRK9",
      rawFormData: null,
    });
    expect(lead.occurredAt.toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });

  it("a new message never moves the date forward", () => {
    const before = threadsOfConversation(CONVO, [msg("2026-10-02T09:00:00.000-04:00", 11, ["Pending"])]);
    const after = threadsOfConversation(CONVO, [
      msg("2026-10-02T09:00:00.000-04:00", 11, ["Pending"]),
      msg("2026-10-18T20:00:00.000-04:00", 11, ["Pending"]),
    ]);
    expect(normalizeText(after[0], "COM1")!.occurredAt).toEqual(normalizeText(before[0], "COM1")!.occurredAt);
  });
});

// ---------------------------------------------------------------------------
// The fetch, against a fake CallRail
// ---------------------------------------------------------------------------

describe("fetchTextThreadsForCompany", () => {
  let requests: URL[] = [];
  function fake(details: Record<string, unknown[]>, pages: unknown[][] = [[CONVO]]) {
    requests = [];
    return vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname === "/v3/a.json") return Response.json({ accounts: [{ id: "ACC1" }] });
      if (url.pathname.endsWith("/text-messages.json")) {
        const page = Number(url.searchParams.get("page"));
        // The list's preview: only the two NEWEST messages.
        return Response.json({ conversations: pages[page - 1] ?? [], total_pages: pages.length });
      }
      const id = url.pathname.split("/").pop()!.replace(".json", "");
      return Response.json({ messages: details[id] ?? [] });
    });
  }

  beforeEach(() => {
    vi.stubEnv("CALLRAIL_API_KEY", "key");
    vi.stubEnv("CALLRAIL_ACCOUNT_ID", "");
    resetTrackerAccountIdCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps an OLDER Signed thread that sits beyond the two-message preview, and drops the untracked thread", async () => {
    vi.stubGlobal(
      "fetch",
      fake({
        CON1: [
          msg("2026-10-01T09:00:00.000-04:00", 11, ["Signed"], "Jane Doe, 555-123-4567"),
          msg("2026-10-12T09:00:00.000-04:00", 12, ["Duplicate"]),
          msg("2026-10-13T09:00:00.000-04:00", 12, ["Duplicate"]),
          msg("2026-10-14T10:00:00.000-04:00", 12, ["Duplicate"]),
        ],
      }),
    );
    const threads = await fetchTextThreadsForCompany("COM1", "2026-10-01", "2026-10-19", { sleep: async () => {} });
    expect(threads.map((t) => [t.id, t.tags])).toEqual([["CON1:11", ["Signed"]]]);
  });

  it("lists by company and date window with the confirmed fields, then fetches each conversation's full history", async () => {
    vi.stubGlobal("fetch", fake({ CON1: [msg("2026-10-02T09:00:00.000-04:00", 11, ["Pending"])] }));
    await fetchTextThreadsForCompany("COM1", "2026-10-01", "2026-10-19", { sleep: async () => {} });
    const list = requests.find((u) => u.pathname.endsWith("/text-messages.json"))!;
    expect(list.pathname).toBe("/v3/a/ACC1/text-messages.json");
    expect(Object.fromEntries(list.searchParams)).toMatchObject({
      company_id: "COM1",
      start_date: "2026-10-01",
      end_date: "2026-10-19",
      per_page: "250",
      fields: CALLRAIL_TRACKER_TEXT_FIELDS.join(","),
    });
    expect(list.searchParams.has("tags[]")).toBe(false); // CallRail cannot filter texts by tag
    const detail = requests.find((u) => u.pathname === "/v3/a/ACC1/text-messages/CON1.json")!;
    expect(detail.searchParams.get("fields")).toBe("messages");
  });

  it("pages through the list", async () => {
    const second = { ...CONVO, id: "CON2" };
    vi.stubGlobal(
      "fetch",
      fake(
        {
          CON1: [msg("2026-10-02T09:00:00.000-04:00", 11, ["Pending"])],
          CON2: [msg("2026-10-03T09:00:00.000-04:00", 21, ["Signed"])],
        },
        [[CONVO], [second]],
      ),
    );
    const threads = await fetchTextThreadsForCompany("COM1", "2026-10-01", "2026-10-19", { sleep: async () => {} });
    expect(threads.map((t) => t.id).sort()).toEqual(["CON1:11", "CON2:21"]);
  });

  it("a failed history fetch fails the pass (it is never silently skipped)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/v3/a.json") return Response.json({ accounts: [{ id: "ACC1" }] });
        if (url.pathname.endsWith("/text-messages.json")) return Response.json({ conversations: [CONVO], total_pages: 1 });
        return new Response("nope", { status: 404 });
      }),
    );
    await expect(fetchTextThreadsForCompany("COM1", "2026-10-01", "2026-10-19", { sleep: async () => {} })).rejects.toThrow(/404/);
  });
});

describe("admin labels and isolation from the PPC/LSA code", () => {
  it("labels text as Text", () => {
    expect(SOURCE_LABEL).toEqual({ call: "Call", form: "Form", text: "Text" });
  });

  it("the tracker's text code never uses the shared CallRail client or the PPC/LSA syncs", () => {
    for (const f of ["src/lib/leads/callrail-client.ts", "src/lib/leads/sync.ts", "src/lib/leads/deps.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/from ["']@\/lib\/(callrail|lsa-sync|ppc-sync)["']/);
      expect(src, f).not.toMatch(/pullTextMessagesForCompany\s*\(/); // never called (a comment may name it)
    }
  });
});
