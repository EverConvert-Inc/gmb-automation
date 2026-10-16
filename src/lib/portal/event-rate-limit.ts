// Best-effort, per-instance limit for the browser events route: at most
// ROUTE_EVENTS_PER_MINUTE events per user per minute before 429. The
// authoritative limits are in the INSERT itself (events.ts), which every
// instance shares through the database.

export const ROUTE_EVENTS_PER_MINUTE = 60;
/** Raw body cap for the route, checked before parsing. A full batch of 10 events is well under 1 KB. */
export const MAX_EVENTS_BODY_CHARS = 2_048;

const recent = new Map<string, number[]>();

export function overEventRateLimit(userId: string, count: number, now = Date.now()): boolean {
  const windowStart = now - 60_000;
  const kept = (recent.get(userId) ?? []).filter((t) => t > windowStart);
  if (kept.length + count > ROUTE_EVENTS_PER_MINUTE) {
    recent.set(userId, kept);
    return true;
  }
  for (let i = 0; i < count; i++) kept.push(now);
  recent.set(userId, kept);
  // Keep the map from growing without bound on a long-lived instance.
  if (recent.size > 5_000) recent.clear();
  return false;
}

/** Test seam only. */
export function __resetEventRateLimitForTests(): void {
  recent.clear();
}
