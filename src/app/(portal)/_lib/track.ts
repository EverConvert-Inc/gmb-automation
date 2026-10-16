// The portal's browser-side activity tracker: date range changes, status
// filter use and search use. Nothing else, and never free text.
//
// What it may send is decided by the PAYLOAD BUILDERS below, which take the
// user's input and return only enums and counts:
//   - a date range becomes { kind, span_days } — the dates themselves never;
//   - a search becomes { kind: "name" | "phone" } — the query never;
//   - a status filter becomes { statuses: [...] } — labels from a fixed list.
// The server re-checks every event against strict schemas and drops any
// extra key, so a change here that leaked text would still not be stored.
//
// Events are queued and sent in batches of up to 10, every 10 seconds or when
// the page is hidden, with keepalive so a tab close still delivers them.
// Sending can never throw into the UI.

import type { BrowserEvent } from "@/lib/portal/event-schema";
import type { PortalStatusLabel } from "@/lib/portal/visibility";

export const TRACK_ENDPOINT = "/api/portal/events";
export const TRACK_FLUSH_MS = 10_000;
export const TRACK_BATCH_MAX = 10;
/** Search: logged once typing pauses this long… */
export const SEARCH_SETTLE_MS = 1_500;
/** …and at most once in this window. */
export const SEARCH_MIN_INTERVAL_MS = 30_000;
/** Status filter: logged once changes pause this long. */
export const FILTER_SETTLE_MS = 1_000;

const STATUSES: readonly PortalStatusLabel[] = ["signed", "pending", "opportunity"];

// ---------------------------------------------------------------------------
// Payload builders — pure, and the only place an event's contents are made
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const isoDay = (iso: string) => {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Number.isNaN(t) ? null : t;
};

/** A preset, or a custom range reduced to its length in days. Dates are not part of the result. */
export function buildDateRangeEvent(
  target: "current" | "previous" | { from: string; to: string },
): BrowserEvent | null {
  if (target === "current") return { type: "date_range_changed", meta: { kind: "preset_current" } };
  if (target === "previous") return { type: "date_range_changed", meta: { kind: "preset_previous" } };
  const a = isoDay(target.from);
  const b = isoDay(target.to);
  if (a === null || b === null || b < a) return null;
  const span = Math.round((b - a) / DAY_MS) + 1;
  return { type: "date_range_changed", meta: { kind: "custom", span_days: Math.min(Math.max(span, 1), 62) } };
}

/** The ticked statuses, as labels from the fixed list only. */
export function buildStatusFilterEvent(selected: Iterable<string>): BrowserEvent {
  const picked = new Set(selected);
  return { type: "status_filter_used", meta: { statuses: STATUSES.filter((s) => picked.has(s)) } };
}

/** Whether a search looks like a name or a phone number. The query itself is not part of the result. */
export function buildSearchEvent(query: string): BrowserEvent | null {
  const q = query.trim();
  if (!q) return null;
  const digits = q.replace(/\D/g, "").length;
  const letters = q.replace(/[^a-z]/gi, "").length;
  return { type: "search_used", meta: { kind: digits >= 2 && digits >= letters ? "phone" : "name" } };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export type TrackerDeps = {
  send: (body: string) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
};

export function createTracker(deps: TrackerDeps) {
  let queue: BrowserEvent[] = [];
  let flushTimer: unknown = null;
  let searchTimer: unknown = null;
  let filterTimer: unknown = null;
  let lastSearchAt = -Infinity;

  function flush() {
    if (flushTimer !== null) {
      deps.clearTimer(flushTimer);
      flushTimer = null;
    }
    while (queue.length > 0) {
      const batch = queue.slice(0, TRACK_BATCH_MAX);
      queue = queue.slice(TRACK_BATCH_MAX);
      try {
        deps.send(JSON.stringify({ events: batch }));
      } catch {
        // Logging must never break the page.
      }
    }
  }

  function enqueue(event: BrowserEvent | null) {
    if (!event) return;
    queue.push(event);
    if (queue.length >= TRACK_BATCH_MAX) flush();
    else if (flushTimer === null) flushTimer = deps.setTimer(flush, TRACK_FLUSH_MS);
  }

  return {
    flush,
    /** Pending events, for tests. */
    pending: () => queue.slice(),
    trackDateRange(target: Parameters<typeof buildDateRangeEvent>[0]) {
      enqueue(buildDateRangeEvent(target));
    },
    trackStatusFilter(selected: Iterable<string>) {
      const event = buildStatusFilterEvent(selected);
      if (filterTimer !== null) deps.clearTimer(filterTimer);
      filterTimer = deps.setTimer(() => {
        filterTimer = null;
        enqueue(event);
      }, FILTER_SETTLE_MS);
    },
    trackSearch(query: string) {
      // Only the derived event is kept, never the query.
      const event = buildSearchEvent(query);
      if (searchTimer !== null) deps.clearTimer(searchTimer);
      searchTimer = null;
      if (!event) return;
      searchTimer = deps.setTimer(() => {
        searchTimer = null;
        if (deps.now() - lastSearchAt < SEARCH_MIN_INTERVAL_MS) return;
        lastSearchAt = deps.now();
        enqueue(event);
      }, SEARCH_SETTLE_MS);
    },
  };
}

// ---------------------------------------------------------------------------
// The browser's tracker
// ---------------------------------------------------------------------------

type Tracker = ReturnType<typeof createTracker>;
let browserTracker: Tracker | null = null;

function tracker(): Tracker | null {
  if (typeof window === "undefined") return null;
  if (!browserTracker) {
    browserTracker = createTracker({
      send: (body) => {
        void fetch(TRACK_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
          credentials: "same-origin",
          cache: "no-store",
        }).catch(() => {});
      },
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id as number),
    });
    const flushNow = () => browserTracker?.flush();
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushNow();
    });
  }
  return browserTracker;
}

export function trackDateRange(target: Parameters<typeof buildDateRangeEvent>[0]): void {
  try {
    tracker()?.trackDateRange(target);
  } catch {}
}
export function trackStatusFilter(selected: Iterable<string>): void {
  try {
    tracker()?.trackStatusFilter(selected);
  } catch {}
}
export function trackSearch(query: string): void {
  try {
    tracker()?.trackSearch(query);
  } catch {}
}
