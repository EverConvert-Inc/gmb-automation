// Shared by getPpcReport (queries.ts) and getLsaReport (queries-lsa.ts) so
// state-based grouping has one implementation instead of two near-identical
// copies. PPC and LSA roll up different metric shapes (clicks/impressions
// vs phone calls/messages/bookings), so this stays generic over both the
// per-client row type and the rollup type — callers supply how to zero and
// fold their own shape.

// The 5 states this report breakdown actively groups by, out of the full
// US state list the ppc_clients.state / lsa_clients.state CHECK constraint
// accepts (see us-states.ts) — a client set to any other valid state (e.g.
// FL) falls into the Unassigned bucket below, same as one with no state set
// at all. Expanding this set is a reporting-scope decision, separate from
// which states the CHECK constraint allows.
export const STATE_ORDER = ["GA", "NC", "SC", "TN", "TX"] as const;
export type StateCode = (typeof STATE_ORDER)[number];

// Bucket for any client row whose state is null, or set to a valid US state
// outside STATE_ORDER. Kept visible rather than silently dropped or folded
// into an existing state.
export const UNASSIGNED_STATE = "Unassigned";

// Display names for STATE_ORDER, shared by the web state-breakdown section
// (state-breakdown-section.tsx) and the PPC/LSA email templates — the
// latter render plain HTML strings server-side, not React, so this can't
// live in a "use client" component. A code with no entry here is the
// Unassigned bucket, rendered with no full name/parenthetical code.
export const STATE_NAMES: Record<StateCode, string> = {
  GA: "Georgia",
  NC: "North Carolina",
  SC: "South Carolina",
  TN: "Tennessee",
  TX: "Texas",
};

export type StateGroup<TClient, TRollup> = {
  state: StateCode | typeof UNASSIGNED_STATE;
  rollup: TRollup;
  clients: TClient[];
};

const STATE_ORDER_SET: ReadonlySet<string> = new Set(STATE_ORDER);

// Groups already-fetched per-client rows by `state` and folds a
// caller-supplied rollup across each group. Group order follows
// STATE_ORDER with "Unassigned" last; a state with zero clients in it is
// omitted rather than rendered as an empty section. A state outside
// STATE_ORDER folds into Unassigned rather than getting its own bucket —
// this is what actually enforces the "any state outside the 5" rule above;
// without it, that client's bucket key would never match anything in the
// STATE_ORDER/Unassigned scan below and it would silently vanish from the
// result instead of landing in Unassigned.
export function groupByState<TClient extends { state: string | null }, TRollup>(
  clients: TClient[],
  zero: () => TRollup,
  add: (rollup: TRollup, client: TClient) => TRollup,
): StateGroup<TClient, TRollup>[] {
  const buckets = new Map<string, TClient[]>();
  for (const c of clients) {
    const key = c.state && STATE_ORDER_SET.has(c.state) ? c.state : UNASSIGNED_STATE;
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
// "Unassigned") with the highest value of the caller-supplied metric, ties
// broken by STATE_ORDER — which is already alphabetical by full state name,
// so "first match while scanning in order" doubles as the alphabetical
// tie-break for free. Falls back to the first group overall only in the
// edge case where every client is Unassigned (no real-state groups at all).
// The metric is a selector rather than a hardcoded `.signedCases` field
// because PPC/LSA's rollups call it that, but Call Quality's equivalent
// "signed" concept is `.real` (see queries-call-quality.ts) — same ranking
// logic, different field name per caller.
export function pickDefaultExpandedState<TRollup>(
  groups: StateGroup<unknown, TRollup>[],
  metric: (rollup: TRollup) => number,
): string | null {
  const realGroups = groups.filter((g) => g.state !== UNASSIGNED_STATE);
  const pool = realGroups.length > 0 ? realGroups : groups;
  if (pool.length === 0) return null;
  let best = pool[0];
  for (const g of pool) {
    if (metric(g.rollup) > metric(best.rollup)) best = g;
  }
  return best.state;
}
