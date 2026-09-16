// Shared by getPpcReport (queries.ts) and getLsaReport (queries-lsa.ts) so
// state-based grouping has one implementation instead of two near-identical
// copies. PPC and LSA roll up different metric shapes (clicks/impressions
// vs phone calls/messages/bookings), so this stays generic over both the
// per-client row type and the rollup type — callers supply how to zero and
// fold their own shape.

// Mirrors the CHECK constraint on ppc_clients.state / lsa_clients.state
// (migration 0043) — the fixed 5-state set this rollout covers.
export const STATE_ORDER = ["GA", "NC", "SC", "TN", "TX"] as const;
export type StateCode = (typeof STATE_ORDER)[number];

// Bucket for any client row whose state hasn't been backfilled yet (or a
// newly-added client created after the backfill). Kept visible rather than
// silently dropped or folded into an existing state.
export const UNASSIGNED_STATE = "Unassigned";

export type StateGroup<TClient, TRollup> = {
  state: StateCode | typeof UNASSIGNED_STATE;
  rollup: TRollup;
  clients: TClient[];
};

// Groups already-fetched per-client rows by `state` and folds a
// caller-supplied rollup across each group. Group order follows
// STATE_ORDER with "Unassigned" last; a state with zero clients in it is
// omitted rather than rendered as an empty section.
export function groupByState<TClient extends { state: string | null }, TRollup>(
  clients: TClient[],
  zero: () => TRollup,
  add: (rollup: TRollup, client: TClient) => TRollup,
): StateGroup<TClient, TRollup>[] {
  const buckets = new Map<string, TClient[]>();
  for (const c of clients) {
    const key = c.state ?? UNASSIGNED_STATE;
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }

  const groups: StateGroup<TClient, TRollup>[] = [];
  for (const state of [...STATE_ORDER, UNASSIGNED_STATE] as const) {
    const clientsInState = buckets.get(state);
    if (!clientsInState || clientsInState.length === 0) continue;
    groups.push({
      state,
      rollup: clientsInState.reduce(add, zero()),
      clients: clientsInState,
    });
  }
  return groups;
}

// Dollars of spend per signed case — the one conversion metric both PPC
// (ppc_callrail_daily.signed_cases) and LSA (lsa_leads_daily.signed_cases)
// already track per client and the number this agency actually bills
// against. Deliberately not Google Ads' own "conversions" or LSA's
// "lead_charged" counts: this codebase's call-quality reporting already
// treats those as a separate, noisier metric from a real signed-case count
// (see queries-call-quality.ts's realCostPerRealLead vs its
// Ads-reported-CPA-denominator comment). Returns null rather than
// Infinity/NaN when there are no signed cases to divide by.
export function costPerSignedCase(costMicros: bigint, signedCases: number): number | null {
  if (signedCases <= 0) return null;
  return Number(costMicros) / 1_000_000 / signedCases;
}

// Which section a report should default to expanded: the real state (never
// "Unassigned") with the most signed cases, ties broken by STATE_ORDER —
// which is already alphabetical by full state name, so "first match while
// scanning in order" doubles as the alphabetical tie-break for free. Falls
// back to the first group overall only in the edge case where every client
// is Unassigned (no real-state groups at all).
export function pickDefaultExpandedState<TRollup extends { signedCases: number }>(
  groups: StateGroup<unknown, TRollup>[],
): string | null {
  const realGroups = groups.filter((g) => g.state !== UNASSIGNED_STATE);
  const pool = realGroups.length > 0 ? realGroups : groups;
  if (pool.length === 0) return null;
  let best = pool[0];
  for (const g of pool) {
    if (g.rollup.signedCases > best.rollup.signedCases) best = g;
  }
  return best.state;
}
