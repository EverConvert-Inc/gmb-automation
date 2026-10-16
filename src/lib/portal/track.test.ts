// The browser tracker: what it sends, and that it can never send free text.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FILTER_SETTLE_MS,
  SEARCH_MIN_INTERVAL_MS,
  SEARCH_SETTLE_MS,
  TRACK_BATCH_MAX,
  TRACK_ENDPOINT,
  TRACK_FLUSH_MS,
  buildDateRangeEvent,
  buildSearchEvent,
  buildStatusFilterEvent,
  createTracker,
} from "@/app/(portal)/_lib/track";
import { BrowserEventBatchSchema, BrowserEventSchema } from "./event-schema";

// A fake clock driving the tracker's timers.
function harness() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sent: string[] = [];
  const t = createTracker({
    send: (body) => void sent.push(body),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const events = () => sent.flatMap((b) => (JSON.parse(b) as { events: unknown[] }).events);
  return { t, sent, advance, events };
}

const FREE_TEXT = [
  "John Smith",
  "smith",
  "555-123-4567",
  "5551234567",
  "(555) 123",
  "john@example.com",
  "2026-09-28",
  "2026-10-03",
  "Called back, wants a consult",
];

describe("payload builders", () => {
  it("a preset is only its name; a custom range is only its length", () => {
    expect(buildDateRangeEvent("current")).toEqual({ type: "date_range_changed", meta: { kind: "preset_current" } });
    expect(buildDateRangeEvent("previous")).toEqual({ type: "date_range_changed", meta: { kind: "preset_previous" } });
    expect(buildDateRangeEvent({ from: "2026-09-28", to: "2026-10-03" })).toEqual({
      type: "date_range_changed",
      meta: { kind: "custom", span_days: 6 },
    });
    expect(buildDateRangeEvent({ from: "2026-10-05", to: "2026-10-05" })?.meta).toEqual({ kind: "custom", span_days: 1 });
    expect(buildDateRangeEvent({ from: "2026-10-05", to: "2026-10-01" })).toBeNull();
    expect(buildDateRangeEvent({ from: "nonsense", to: "2026-10-01" })).toBeNull();
  });

  it("a status filter is only labels from the fixed list", () => {
    expect(buildStatusFilterEvent(new Set(["pending", "signed"]))).toEqual({
      type: "status_filter_used",
      meta: { statuses: ["signed", "pending"] },
    });
    expect(buildStatusFilterEvent(["signed", "John Smith", "555"]).meta).toEqual({ statuses: ["signed"] });
    expect(buildStatusFilterEvent([]).meta).toEqual({ statuses: [] });
  });

  it.each([
    ["john", "name"],
    ["John Smith", "name"],
    ["555-123", "phone"],
    ["(555) 123-4567", "phone"],
    ["5", "name"],
    ["Jo 2", "name"],
  ])("search %j is only %s", (q, kind) => {
    expect(buildSearchEvent(q)).toEqual({ type: "search_used", meta: { kind } });
  });

  it("an empty search is nothing", () => {
    expect(buildSearchEvent("   ")).toBeNull();
  });

  it("whatever goes in, no free text comes out, and every event passes the server's schema", () => {
    const outputs = [
      ...FREE_TEXT.map((s) => buildSearchEvent(s)),
      buildStatusFilterEvent(FREE_TEXT),
      buildDateRangeEvent({ from: "2026-09-28", to: "2026-10-03" }),
      buildDateRangeEvent("current"),
    ].filter(Boolean);
    const json = JSON.stringify(outputs);
    for (const s of FREE_TEXT) expect(json).not.toContain(s);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    for (const e of outputs) expect(BrowserEventSchema.safeParse(e).success).toBe(true);
  });
});

describe("the queue", () => {
  it("sends nothing at once; one batch after 10s", () => {
    const h = harness();
    h.t.trackDateRange("previous");
    h.t.trackDateRange({ from: "2026-10-01", to: "2026-10-03" });
    expect(h.sent).toEqual([]);
    h.advance(TRACK_FLUSH_MS);
    expect(h.sent).toHaveLength(1);
    expect(BrowserEventBatchSchema.safeParse(JSON.parse(h.sent[0])).success).toBe(true);
    expect(h.events()).toHaveLength(2);
  });

  it(`sends at once when ${TRACK_BATCH_MAX} are queued, never more than ${TRACK_BATCH_MAX} per request`, () => {
    const h = harness();
    for (let i = 0; i < 25; i++) h.t.trackDateRange("current");
    h.t.flush();
    expect(h.sent.map((b) => JSON.parse(b).events.length)).toEqual([10, 10, 5]);
  });

  it("flush() (page hidden / closed) sends what is queued", () => {
    const h = harness();
    h.t.trackDateRange("current");
    h.t.flush();
    expect(h.sent).toHaveLength(1);
    h.advance(TRACK_FLUSH_MS);
    expect(h.sent).toHaveLength(1); // the pending timer was cleared
  });

  it("search: once typing settles, at most once per 30s, and never the text", () => {
    const h = harness();
    for (const q of ["j", "jo", "joh", "john"]) h.t.trackSearch(q);
    h.advance(SEARCH_SETTLE_MS);
    expect(h.t.pending()).toEqual([{ type: "search_used", meta: { kind: "name" } }]);
    h.t.trackSearch("john smith");
    h.advance(SEARCH_SETTLE_MS);
    expect(h.t.pending()).toHaveLength(1); // within 30s: not logged again
    h.advance(SEARCH_MIN_INTERVAL_MS);
    h.t.trackSearch("555-1");
    h.advance(SEARCH_SETTLE_MS);
    h.advance(TRACK_FLUSH_MS);
    expect(h.events()).toEqual([
      { type: "search_used", meta: { kind: "name" } },
      { type: "search_used", meta: { kind: "phone" } },
    ]);
    expect(h.sent.join("")).not.toMatch(/john|555/i);
  });

  it("clearing the search box logs nothing", () => {
    const h = harness();
    h.t.trackSearch("john");
    h.t.trackSearch("");
    h.advance(SEARCH_SETTLE_MS + TRACK_FLUSH_MS);
    expect(h.sent).toEqual([]);
  });

  it("status filter: one event once changes settle, with the final selection", () => {
    const h = harness();
    h.t.trackStatusFilter(["signed"]);
    h.t.trackStatusFilter(["signed", "pending"]);
    h.advance(FILTER_SETTLE_MS);
    expect(h.t.pending()).toEqual([{ type: "status_filter_used", meta: { statuses: ["signed", "pending"] } }]);
  });

  it("a send that throws never reaches the page", () => {
    const t = createTracker({
      send: () => {
        throw new Error("offline");
      },
      now: () => 0,
      setTimer: () => 1,
      clearTimer: () => {},
    });
    t.trackDateRange("current");
    expect(() => t.flush()).not.toThrow();
  });
});

// Source checks: the payload builders are the only way anything is sent.
describe("source", () => {
  const PORTAL = join(process.cwd(), "src", "app", "(portal)");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  const read = (f: string) => readFileSync(f, "utf8");
  const trackSrc = read(join(PORTAL, "_lib", "track.ts"));

  it("only track.ts talks to the events endpoint", () => {
    for (const f of files(PORTAL).filter((f) => /\.tsx?$/.test(f) && !f.endsWith("track.ts"))) {
      expect(read(f), f).not.toContain(TRACK_ENDPOINT);
      expect(read(f), f).not.toMatch(/sendBeacon/);
    }
  });

  it("the one fetch sends a body made only from queued builder output", () => {
    expect(trackSrc.match(/fetch\(/g)).toHaveLength(1);
    expect(trackSrc).toContain("deps.send(JSON.stringify({ events: batch }))");
    // Inputs reach the queue only through a builder.
    expect(trackSrc.match(/enqueue\(/g)?.length).toBe(4); // definition + date range + filter + search
    expect(trackSrc).toContain("enqueue(buildDateRangeEvent(target))");
    expect(trackSrc).not.toMatch(/meta:\s*\{[^}]*\b(query|q|from|to|name|phone|email|body|text)\s*[:,}]/);
  });

  it("components hand the tracker only the selection, the range or the box's value — and nothing else is logged", () => {
    const view = read(join(PORTAL, "_components", "leads-view.tsx"));
    const picker = read(join(PORTAL, "_components", "date-range-picker.tsx"));
    expect(view.match(/track(Search|StatusFilter|DateRange)\(/g)?.sort()).toEqual([
      "trackSearch(",
      "trackStatusFilter(",
      "trackStatusFilter(",
    ]);
    expect(picker.match(/trackDateRange\(/g)).toHaveLength(1);
    for (const src of [view, picker, read(join(PORTAL, "_components", "lead-note.tsx"))]) {
      expect(src).not.toMatch(/from\s+["']@\/lib\/portal\/events["']/);
    }
  });
});
