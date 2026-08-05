import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "./db/client";
import {
  callSignedEvents,
  lsaCallrailTagCategories,
  lsaClients,
  lsaLeadsDaily,
  lsaSyncJobs,
  lsaTextConversationTagState,
  oauthCredentials,
  ppcClients,
  textConversationSignedEvents,
  type LsaClient,
} from "./db/schema";
import { decryptString } from "./crypto";
import { pullLocalServicesCost, pullLocalServicesLeads } from "./google-ads";
import {
  pullCallsForCompany,
  pullTextMessagesForCompany,
  type CallrailDailyTotals,
} from "./callrail";
import { yesterdayIsoEastern, daysAgoIsoEastern } from "./date-utils";

type SyncOpts = {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  triggeredBy?: string; // "scheduled" | "manual" | "manual-backfill" | ...
};

// Re-exported under the original names so every existing caller (cron
// routes, sync-now routes) is unaffected — see date-utils.ts for why this
// is Eastern-based rather than UTC.
export const yesterdayIso = yesterdayIsoEastern;
export const daysAgoIso = daysAgoIsoEastern;

async function startJob(
  lsaClientId: string | null,
  kind: "google_ads" | "callrail",
  triggeredBy: string,
): Promise<string> {
  const [row] = await db
    .insert(lsaSyncJobs)
    .values({
      lsaClientId,
      kind,
      status: "running",
      startedAt: new Date(),
      triggeredBy,
    })
    .returning();
  return row.id;
}

async function finishJob(
  jobId: string,
  status: "completed" | "failed",
  errorMessage: string | null,
) {
  await db
    .update(lsaSyncJobs)
    .set({
      status,
      completedAt: new Date(),
      errorMessage: errorMessage?.slice(0, 2000) ?? null,
    })
    .where(eq(lsaSyncJobs.id, jobId));
}

type DayBucket = {
  date: string;
  phoneCallCount: number;
  messageCount: number;
  bookingCount: number;
  chargedCount: number;
  statusBreakdown: Record<string, number>;
  costMicros: bigint;
  signedCases: number;
  // Flat, blended tag category counts for the Ads Conversion Tracker x
  // CallRail report — flat when this client's CallRail company has a
  // matching PPC record (GMB stays owned by that side, no split here),
  // channel-nested (keyed "LSA"/"GMB") when it doesn't. See the
  // hasMatchingPpcClient check in the CallRail sync block below.
  tagCategoryBreakdown: Record<string, unknown>;
  // Per-call real/junk/unclassified counts (capped at 1 per call) — see
  // CallrailRollupCounts in callrail.ts. Same flat-vs-nested split as
  // tagCategoryBreakdown above.
  rollupCounts: Record<string, unknown>;
  // CallRail's first_call flag, counted per day. Same flat-vs-nested split
  // as tagCategoryBreakdown/rollupCounts above — a flat number (today's
  // shape) or a per-channel object (keyed "LSA"/"GMB").
  firstTimeCalls: unknown;
  adsFetched: boolean;
  callrailFetched: boolean;
};

function emptyBucket(date: string): DayBucket {
  return {
    date,
    phoneCallCount: 0,
    messageCount: 0,
    bookingCount: 0,
    chargedCount: 0,
    statusBreakdown: {},
    costMicros: 0n,
    signedCases: 0,
    tagCategoryBreakdown: {},
    rollupCounts: { real: 0, junk: 0, unclassified: 0 },
    firstTimeCalls: 0,
    adsFetched: false,
    callrailFetched: false,
  };
}

// Merges a delta (+1/-1) into a real/junk/unclassified rollup value that
// may be flat or channel-nested — same shape convention as
// normalizeLsaBreakdown (queries-call-quality.ts) and the text-message
// merge below: nested iff some existing value is itself an object. When
// `current` has no keys at all yet (a date with no stored row/bucket to
// detect shape from), there's nothing to infer from, so the shape to
// CREATE follows whether `channel` is non-null (this client owns a GMB
// split — use nested, keyed by that channel) or null (flat).
export function adjustRollupReal(
  current: Record<string, unknown>,
  channel: "GMB" | "PPC" | "LSA" | "PMax" | null,
  delta: number,
): Record<string, unknown> {
  const hasAnyValue = Object.keys(current).length > 0;
  const isNested = hasAnyValue
    ? Object.values(current).some((v) => v !== null && typeof v === "object")
    : channel !== null;
  if (isNested) {
    const nested = current as Record<
      string,
      { real: number; junk: number; unclassified: number }
    >;
    const key = channel ?? "LSA";
    const existing = nested[key] ?? { real: 0, junk: 0, unclassified: 0 };
    return { ...nested, [key]: { ...existing, real: existing.real + delta } };
  }
  const flat = current as { real?: number; junk?: number; unclassified?: number };
  return {
    real: (flat.real ?? 0) + delta,
    junk: flat.junk ?? 0,
    unclassified: flat.unclassified ?? 0,
  };
}

// Same flat-vs-channel-nested shape convention as adjustRollupReal above,
// generalized to an arbitrary set of tag-category labels instead of a
// fixed real/junk/unclassified shape — used to keep tagCategoryBreakdown
// in sync with the same redirect that moves signedCases/rollupBreakdown,
// so a redirected call's row never ends up self-contradictory (a tag count
// present with no matching rollup/signedCases contribution, or vice
// versa). No-ops on an empty label list (nothing to adjust).
export function adjustTagCategoryBreakdown(
  current: Record<string, unknown>,
  channel: "GMB" | "PPC" | "LSA" | "PMax" | null,
  labels: string[],
  delta: number,
): Record<string, unknown> {
  if (labels.length === 0) return current;
  const hasAnyValue = Object.keys(current).length > 0;
  const isNested = hasAnyValue
    ? Object.values(current).some((v) => v !== null && typeof v === "object")
    : channel !== null;
  if (isNested) {
    const nested = current as Record<string, Record<string, number>>;
    const key = channel ?? "LSA";
    const existing = { ...(nested[key] ?? {}) };
    for (const label of labels) {
      existing[label] = (existing[label] ?? 0) + delta;
    }
    return { ...nested, [key]: existing };
  }
  const flat = { ...(current as Record<string, number>) };
  for (const label of labels) {
    flat[label] = (flat[label] ?? 0) + delta;
  }
  return flat;
}

// Shared by syncLsaForClient's regular per-day loop and
// recomputeLsaCallrailDay's targeted single-day recompute (see below) —
// fetches this client's CallRail calls for [fromDate, toDate], writes their
// (uncorrected) contribution into `bucket()`'s day buckets exactly as
// before this feature existed, and returns both the fetched rows (for the
// signed-date redistribution step) and the resolved tag categories (the
// full sync also needs these for its text-message pull).
async function fetchAndBucketLsaCalls(
  client: LsaClient,
  fromDate: string,
  toDate: string,
  bucket: (date: string) => DayBucket,
): Promise<{
  rows: CallrailDailyTotals[];
  tagCategories: Array<{ label: string; callrailTagName: string; rollup: "real" | "junk" }>;
}> {
  // rollup is stored as plain text (no DB-level enum); narrowed here since
  // the tag-category API routes are the only writers and always validate
  // it against z.enum(["real", "junk"]) before insert/update.
  const tagCategories = (
    await db.query.lsaCallrailTagCategories.findMany({
      where: eq(lsaCallrailTagCategories.lsaClientId, client.id),
    })
  ).map((c) => ({ ...c, rollup: c.rollup as "real" | "junk" }));

  // GMB classification is only ever done from one side of a shared
  // CallRail company — see syncLsaForClient's original comment on this
  // exact check.
  const hasMatchingPpcClient = !!(
    await db.query.ppcClients.findFirst({
      where: eq(ppcClients.callrailCompanyId, client.callrailCompanyId!),
      columns: { id: true },
    })
  );
  const gmbNameFilters =
    hasMatchingPpcClient || client.gmbCallrailNameFilters.length === 0
      ? undefined
      : client.gmbCallrailNameFilters;

  const rows = await pullCallsForCompany(
    client.callrailCompanyId!,
    fromDate,
    toDate,
    client.signedCaseTag,
    client.signedCaseNameFilters,
    tagCategories,
    gmbNameFilters,
    "LSA",
  );
  for (const r of rows) {
    const b = bucket(r.date);
    b.signedCases = r.signedCases;
    // A day where this client had calls but none matched either the LSA
    // or GMB filter leaves channelBreakdown genuinely empty ({}) — still
    // truthy, so also checking its key count here to fall through to the
    // flat branch below instead of writing three ambiguous empty objects
    // (which the reader would otherwise have to reconstruct a zero value
    // from, rather than a clean 0/{}).
    if (r.channelBreakdown && Object.keys(r.channelBreakdown).length > 0) {
      // No matching PPC record — this client owns its own GMB split.
      // Store channel-nested, mirroring ppc_callrail_daily's shape.
      b.tagCategoryBreakdown = Object.fromEntries(
        Object.entries(r.channelBreakdown).map(([channel, cb]) => [
          channel,
          cb.tagCategoryBreakdown,
        ]),
      );
      b.rollupCounts = Object.fromEntries(
        Object.entries(r.channelBreakdown).map(([channel, cb]) => [
          channel,
          cb.rollupCounts,
        ]),
      );
      b.firstTimeCalls = Object.fromEntries(
        Object.entries(r.channelBreakdown).map(([channel, cb]) => [
          channel,
          cb.firstTimeCalls,
        ]),
      );
    } else {
      // Shared-company client — unchanged, flat shape.
      b.tagCategoryBreakdown = r.tagCategoryBreakdown;
      b.rollupCounts = r.rollupCounts;
      b.firstTimeCalls = r.firstTimeCalls;
    }
    b.callrailFetched = true;
  }

  return { rows, tagCategories };
}

// The "true sign date" correction — redirects a call's signedCases/
// rollupReal contribution from its own date to the date it was ACTUALLY
// signed (per call_signed_events), for every candidate pullCallsForCompany
// flagged as independently qualifying for at least one of those two
// metrics. A call with no call_signed_events row, or whose signed_at falls
// on the same date it already counts toward, is left completely untouched
// — today's behavior, unchanged; this is the explicit "no matching row —
// fall back to current behavior" and "same-month — no visible change"
// requirement.
//
// This only ever handles the ORIGIN side: the candidate's own date is
// always one of `bucket()`'s in-memory buckets (it came from a row just
// fetched in this run), so the decrement happens directly in-memory here.
// The TARGET side (adding the redirected contribution to the signed_at
// date) is deliberately NOT done here — see applyRedirectedInContributions
// below, which re-derives every target date's redirected-in total straight
// from call_signed_events itself. That split is what makes the correction
// durable: this function also persists the call's classification
// (isSignedCase/isRollupReal/channel) onto the call_signed_events row it
// matched, so a LATER sync that only touches the target date (without ever
// re-fetching this call's origin date again) can still reconstruct the
// redirect from that persisted row, instead of the one-time in-memory/
// standalone write silently getting erased by the next regular resync of
// the target date.
async function applySignedDateCorrections(
  lsaClientId: string,
  rows: CallrailDailyTotals[],
  bucket: (date: string) => DayBucket,
): Promise<Set<string>> {
  const candidates = rows.flatMap((r) => r.signedRealCandidates);
  console.log(
    `[lsa-sync][signed-correction] lsa_client ${lsaClientId}: ${candidates.length} signedRealCandidate(s) across ${rows.length} fetched day(s)`,
    candidates.map((c) => ({
      callId: c.callId,
      date: c.date,
      isSignedCase: c.isSignedCase,
      isRollupReal: c.isRollupReal,
      channel: c.channel,
    })),
  );
  const redirectedTargetDates = new Set<string>();
  if (candidates.length === 0) return redirectedTargetDates;

  const events = await db.query.callSignedEvents.findMany({
    where: inArray(
      callSignedEvents.callrailCallId,
      candidates.map((c) => c.callId),
    ),
  });
  console.log(
    `[lsa-sync][signed-correction] lsa_client ${lsaClientId}: ${events.length} matching call_signed_events row(s) found for ${candidates.length} candidate(s)`,
    events.map((e) => ({ callId: e.callrailCallId, signedAt: e.signedAt.toISOString() })),
  );
  const eventByCallId = new Map(events.map((e) => [e.callrailCallId, e]));

  for (const c of candidates) {
    const event = eventByCallId.get(c.callId);
    if (!event) {
      console.log(
        `[lsa-sync][signed-correction] call ${c.callId}: no call_signed_events row — no correction, counts toward its own date ${c.date} as before`,
      );
      continue;
    }
    const signedDate = event.signedAt.toISOString().slice(0, 10);
    if (signedDate === c.date) {
      console.log(
        `[lsa-sync][signed-correction] call ${c.callId}: signed_at date (${signedDate}) matches its own date — no-op, no visible change`,
      );
      continue;
    }

    const origin = bucket(c.date);
    if (c.isSignedCase) origin.signedCases -= 1;
    if (c.isRollupReal) {
      origin.rollupCounts = adjustRollupReal(origin.rollupCounts, c.channel, -1);
    }
    if (c.tagCategoryLabels.length > 0) {
      origin.tagCategoryBreakdown = adjustTagCategoryBreakdown(
        origin.tagCategoryBreakdown,
        c.channel,
        c.tagCategoryLabels,
        -1,
      );
    }

    await db
      .update(callSignedEvents)
      .set({
        isSignedCase: c.isSignedCase,
        isRollupReal: c.isRollupReal,
        channel: c.channel,
        tagCategoryLabels: c.tagCategoryLabels,
      })
      .where(eq(callSignedEvents.callrailCallId, c.callId));

    redirectedTargetDates.add(signedDate);
    console.log(
      `[lsa-sync][signed-correction] call ${c.callId}: redirected ${c.date} -> ${signedDate}; persisted classification onto call_signed_events for durable redirected-in reconstruction`,
      {
        isSignedCase: c.isSignedCase,
        isRollupReal: c.isRollupReal,
        channel: c.channel,
        tagCategoryLabels: c.tagCategoryLabels,
      },
    );
  }
  return redirectedTargetDates;
}

// The TARGET side of the true-sign-date correction — re-derives every
// redirected-in contribution landing within [fromDate, toDate] straight
// from call_signed_events's persisted classification (written by
// applySignedDateCorrections above), and adds it into that date's bucket.
// Because this reads from the durable source of truth rather than an
// in-memory value computed earlier in the SAME run, a later sync that only
// covers the target date (its origin date long out of range, or from a
// prior run entirely) still reconstructs the correction correctly instead
// of losing it to a wholesale bucket replace.
//
// Only rows with a persisted (non-null) classification are considered —
// applySignedDateCorrections only ever persists one when it found a
// genuine redirect (signedDate !== the call's own date), so this can never
// double-count a call under both its own date (via the normal fresh pull)
// and its target date.
async function applyRedirectedInContributions(
  callrailCompanyId: string,
  fromDate: string,
  toDate: string,
  bucket: (date: string) => DayBucket,
): Promise<void> {
  const events = await db.query.callSignedEvents.findMany({
    where: and(
      eq(callSignedEvents.callrailCompanyId, callrailCompanyId),
      isNotNull(callSignedEvents.isSignedCase),
    ),
  });
  for (const e of events) {
    const targetDate = e.signedAt.toISOString().slice(0, 10);
    if (targetDate < fromDate || targetDate > toDate) continue;

    const b = bucket(targetDate);
    if (e.isSignedCase) b.signedCases += 1;
    if (e.isRollupReal) {
      b.rollupCounts = adjustRollupReal(
        b.rollupCounts,
        e.channel as "GMB" | "PPC" | "LSA" | "PMax" | null,
        1,
      );
    }
    if (e.tagCategoryLabels && e.tagCategoryLabels.length > 0) {
      b.tagCategoryBreakdown = adjustTagCategoryBreakdown(
        b.tagCategoryBreakdown,
        e.channel as "GMB" | "PPC" | "LSA" | "PMax" | null,
        e.tagCategoryLabels,
        1,
      );
    }
    b.callrailFetched = true;
    console.log(
      `[lsa-sync][signed-correction] redirected-in: call ${e.callrailCallId} contributes to ${targetDate}`,
      {
        isSignedCase: e.isSignedCase,
        isRollupReal: e.isRollupReal,
        channel: e.channel,
        tagCategoryLabels: e.tagCategoryLabels,
      },
    );
  }
}

// Runs both sides of the true-sign-date correction for a single fetch
// range: decrement+persist on the origin side (applySignedDateCorrections),
// then re-derive every redirected-in contribution landing in this same
// range (applyRedirectedInContributions). A redirect target that falls
// OUTSIDE [fromDate, toDate] has nothing to merge into here — instead it's
// handled by fully recomputing that date on its own via
// recomputeLsaCallrailDay, exactly like a webhook-triggered correction
// would. `visitedDates` guards that recursion against ever revisiting the
// same date twice within one top-level trigger.
async function applyTrueSignDateCorrections(
  lsaClientId: string,
  callrailCompanyId: string,
  fromDate: string,
  toDate: string,
  rows: CallrailDailyTotals[],
  bucket: (date: string) => DayBucket,
  visitedDates: Set<string>,
): Promise<void> {
  const redirectedTargetDates = await applySignedDateCorrections(lsaClientId, rows, bucket);
  await applyRedirectedInContributions(callrailCompanyId, fromDate, toDate, bucket);

  for (const targetDate of redirectedTargetDates) {
    if (targetDate >= fromDate && targetDate <= toDate) continue; // already merged in above
    if (visitedDates.has(targetDate)) continue;
    console.log(
      `[lsa-sync][signed-correction] target date ${targetDate} is outside this run's fetched range [${fromDate}, ${toDate}] — recomputing it directly`,
    );
    await recomputeLsaCallrailDay(lsaClientId, targetDate, visitedDates);
  }
}

// CallRail-only, single-date recompute — called by the Call Modified
// webhook receiver immediately after a NEW call_signed_events row is
// recorded (see callrail-webhook.ts), to correct the call's OWN date right
// away instead of waiting for a full sync that will never revisit it (the
// regular daily cron only ever processes "yesterday" — it has no reason to
// ever look at an old date again on its own). Deliberately does NOT touch
// Google Ads at all, unlike syncLsaForClient — this is triggered by a
// CallRail-only event and re-running an unrelated Ads pull for a single
// historical day would be pure waste inside a webhook's response cycle.
export async function recomputeLsaCallrailDay(
  lsaClientId: string,
  date: string,
  visitedDates: Set<string> = new Set(),
): Promise<void> {
  if (visitedDates.has(date)) {
    console.log(
      `[lsa-sync][signed-correction] recomputeLsaCallrailDay skip: lsa_client=${lsaClientId} date=${date} already visited this run (recursion guard)`,
    );
    return;
  }
  visitedDates.add(date);
  console.log(`[lsa-sync][signed-correction] recomputeLsaCallrailDay start: lsa_client=${lsaClientId} date=${date}`);
  const client = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, lsaClientId),
  });
  if (!client?.callrailCompanyId) {
    console.log(
      `[lsa-sync][signed-correction] recomputeLsaCallrailDay abort: lsa_client=${lsaClientId} not found or has no callrail_company_id`,
    );
    return;
  }

  const byDate = new Map<string, DayBucket>();
  function bucket(d: string): DayBucket {
    const existing = byDate.get(d);
    if (existing) return existing;
    const created = emptyBucket(d);
    byDate.set(d, created);
    return created;
  }

  const { rows } = await fetchAndBucketLsaCalls(client, date, date, bucket);
  console.log(
    `[lsa-sync][signed-correction] recomputeLsaCallrailDay: pullCallsForCompany(${date}, ${date}) returned ${rows.length} day-row(s) for company ${client.callrailCompanyId}`,
    rows.map((r) => ({
      date: r.date,
      totalCalls: r.totalCalls,
      signedCases: r.signedCases,
      rollupCounts: r.rollupCounts,
      channelBreakdown: r.channelBreakdown,
      signedRealCandidates: r.signedRealCandidates,
    })),
  );
  await applyTrueSignDateCorrections(
    lsaClientId,
    client.callrailCompanyId,
    date,
    date,
    rows,
    bucket,
    visitedDates,
  );

  for (const row of byDate.values()) {
    if (!row.callrailFetched) continue;
    console.log(
      `[lsa-sync][signed-correction] recomputeLsaCallrailDay: upserting lsa_leads_daily for lsa_client=${lsaClientId} date=${row.date}`,
      { signedCases: row.signedCases, rollupBreakdown: row.rollupCounts, tagCategoryBreakdown: row.tagCategoryBreakdown },
    );
    const now = new Date();
    await db
      .insert(lsaLeadsDaily)
      .values({
        lsaClientId,
        date: row.date,
        signedCases: row.signedCases,
        tagCategoryBreakdown: row.tagCategoryBreakdown,
        rollupBreakdown: row.rollupCounts,
        firstTimeCalls: row.firstTimeCalls,
        ingestedAt: now,
      })
      .onConflictDoUpdate({
        target: [lsaLeadsDaily.lsaClientId, lsaLeadsDaily.date],
        set: {
          signedCases: row.signedCases,
          tagCategoryBreakdown: row.tagCategoryBreakdown,
          rollupBreakdown: row.rollupCounts,
          firstTimeCalls: row.firstTimeCalls,
          ingestedAt: now,
        },
      });
  }
  console.log(`[lsa-sync][signed-correction] recomputeLsaCallrailDay done: lsa_client=${lsaClientId} date=${date}`);
}

// Pulls Google Ads (local_services_lead + LOCAL_SERVICES campaign cost) and
// CallRail (signed cases) independently, merges both into one row per day,
// and upserts into lsa_leads_daily. Unlike ppc-sync.ts's two separate
// per-source sync functions, this bundles both sources into a single
// client-level sync because lsa_leads_daily is one merged fact table, not
// a join at report time (see schema.ts comment on lsa_leads_daily).
//
// Each source is tried independently and failures don't block the other:
// if CallRail fails but Ads succeeds, the Ads-derived fields still get
// written. The upsert's `set` clause only includes fields for a source
// that actually succeeded this run, so a transient failure on one side
// never overwrites previously-good data from the other side with zeros.
//
// Every failure is both recorded to lsa_sync_jobs AND logged via
// console.error — ppc-callrail-sync's cron route recorded failures to the
// DB but never logged them anywhere a human would see without querying
// the table directly; this closes that gap from day one.
export async function syncLsaForClient(
  lsaClientId: string,
  opts: SyncOpts,
): Promise<{
  daysWritten: number;
  adsJobId: string | null;
  callrailJobId: string | null;
  adsError: string | null;
  callrailError: string | null;
}> {
  const triggeredBy = opts.triggeredBy ?? "manual";
  const client = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, lsaClientId),
  });
  if (!client) throw new Error(`LSA client ${lsaClientId} not found`);
  if (!client.googleAdsCustomerId && !client.callrailCompanyId) {
    throw new Error("LSA client is not linked to Google Ads or CallRail");
  }

  const byDate = new Map<string, DayBucket>();
  function bucket(date: string): DayBucket {
    const existing = byDate.get(date);
    if (existing) return existing;
    const created = emptyBucket(date);
    byDate.set(date, created);
    return created;
  }

  let adsJobId: string | null = null;
  let adsError: string | null = null;
  // Triggers on googleAdsCustomerId alone — a customer id set without a
  // linked OAuth credential is a real misconfiguration (e.g. the operator
  // typed a customer id but the OAuth attach step never completed), not a
  // "nothing to do here" case. That combination must still produce a
  // recorded, logged failure below rather than silently skipping the
  // client, which is the exact gap this rebuild exists to close.
  if (client.googleAdsCustomerId) {
    adsJobId = await startJob(lsaClientId, "google_ads", triggeredBy);
    try {
      if (!client.googleAdsOauthTokenId) {
        throw new Error(
          "LSA client has a Google Ads customer id but no linked OAuth credential",
        );
      }
      const cred = await db.query.oauthCredentials.findFirst({
        where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
      });
      if (!cred) throw new Error("OAuth credential row missing");
      const refreshToken = decryptString(cred.refreshTokenEncrypted);

      const [leadRows, costRows] = await Promise.all([
        pullLocalServicesLeads(
          refreshToken,
          client.googleAdsCustomerId,
          client.loginCustomerId ?? undefined,
          opts.fromDate,
          opts.toDate,
        ),
        pullLocalServicesCost(
          refreshToken,
          client.googleAdsCustomerId,
          client.loginCustomerId ?? undefined,
          opts.fromDate,
          opts.toDate,
        ),
      ]);

      for (const r of leadRows) {
        const b = bucket(r.date);
        b.phoneCallCount = r.phoneCallCount;
        b.messageCount = r.messageCount;
        b.bookingCount = r.bookingCount;
        b.chargedCount = r.chargedCount;
        b.statusBreakdown = r.statusBreakdown;
        b.adsFetched = true;
      }
      for (const r of costRows) {
        const b = bucket(r.date);
        b.costMicros = r.costMicros;
        b.adsFetched = true;
      }

      await db
        .update(lsaClients)
        .set({ lastAdsSyncAt: new Date(), lastSyncError: null })
        .where(eq(lsaClients.id, lsaClientId));
      await finishJob(adsJobId, "completed", null);
    } catch (err) {
      const msg = (err as Error).message;
      adsError = msg;
      console.error(`[lsa-sync] google_ads failed for lsa_client ${lsaClientId}:`, msg);
      await finishJob(adsJobId, "failed", msg);
      await db
        .update(lsaClients)
        .set({ lastSyncError: msg })
        .where(eq(lsaClients.id, lsaClientId));
    }
  }

  let callrailJobId: string | null = null;
  let callrailError: string | null = null;
  if (client.callrailCompanyId) {
    callrailJobId = await startJob(lsaClientId, "callrail", triggeredBy);
    try {
      const { rows, tagCategories } = await fetchAndBucketLsaCalls(
        client,
        opts.fromDate,
        opts.toDate,
        bucket,
      );

      // True-sign-date correction (see applyTrueSignDateCorrections) —
      // redirects any call whose call_signed_events entry points at a
      // different date than the one it was just bucketed under above.
      // Wrapped in its own try/catch: a failure here must not block the
      // calls-derived data that's already been correctly bucketed (falls
      // back to counting toward each call's own date, same as before this
      // feature existed).
      try {
        await applyTrueSignDateCorrections(
          lsaClientId,
          client.callrailCompanyId,
          opts.fromDate,
          opts.toDate,
          rows,
          bucket,
          new Set<string>(),
        );
      } catch (err) {
        console.error(
          `[lsa-sync] signed-date correction failed for lsa_client ${lsaClientId}:`,
          (err as Error).message,
        );
      }

      // Text/message conversations — a separate CallRail resource
      // (/text-messages.json) pullCallsForCompany never touches, so a
      // Signed tag applied to a message conversation was silently
      // uncounted (confirmed real via manual CallRail UI inspection).
      // Wrapped in its own try/catch — a failure here shouldn't block the
      // calls-derived data above from being written, same per-source
      // resilience already applied to the ads-vs-callrail split.
      try {
        const { dailyRollups: messageRollups, conversationRollups } =
          await pullTextMessagesForCompany(
            client.callrailCompanyId,
            opts.fromDate,
            opts.toDate,
            client.signedCaseNameFilters,
            tagCategories,
          );
        for (const r of messageRollups) {
          const b = bucket(r.date);
          const current = b.rollupCounts as Record<string, unknown>;
          // Detect shape from the bucket's OWN current value, not from
          // gmbNameFilters — even a channel-splitting client can have a
          // genuinely flat rollupCounts for a given date (the calls loop
          // above falls back to flat whenever that day's calls matched no
          // channel at all), and queries-call-quality.ts's
          // normalizeLsaBreakdown already reads a flat day as 100% "LSA"
          // at report time. Same detection rule as that function: nested
          // iff some value is itself an object.
          const isNested = Object.values(current).some(
            (v) => v !== null && typeof v === "object",
          );
          if (isNested) {
            // Fold into the "LSA" channel specifically (never GMB/PPC/
            // PMax — a Signed message conversation is an LSA-tracker
            // concept), preserving every other channel key untouched.
            const nested = current as Record<
              string,
              { real: number; junk: number; unclassified: number }
            >;
            const existingLsa = nested.LSA ?? {
              real: 0,
              junk: 0,
              unclassified: 0,
            };
            b.rollupCounts = {
              ...nested,
              LSA: { ...existingLsa, real: existingLsa.real + r.real },
            };
          } else {
            const flat = current as {
              real?: number;
              junk?: number;
              unclassified?: number;
            };
            b.rollupCounts = {
              real: (flat.real ?? 0) + r.real,
              junk: flat.junk ?? 0,
              unclassified: flat.unclassified ?? 0,
            };
          }
          b.callrailFetched = true;
        }

        // "True sign date" approximation for text conversations — purely
        // additive bookkeeping (see lsaTextConversationTagState /
        // textConversationSignedEvents in schema.ts). Own try/catch so a
        // failure here can never affect the message-count merge above,
        // which has already succeeded by this point, or the calls-derived
        // data written outside this try block. Never reads or writes
        // rollup_breakdown/tag_category_breakdown/signed_cases, never
        // touches lsa_leads_daily, and nothing downstream (report queries,
        // web/PDF/email) reads these two tables yet.
        try {
          if (conversationRollups.length > 0) {
            const conversationIds = conversationRollups.map(
              (c) => c.conversationId,
            );
            const existingStates =
              await db.query.lsaTextConversationTagState.findMany({
                where: and(
                  eq(lsaTextConversationTagState.lsaClientId, lsaClientId),
                  inArray(
                    lsaTextConversationTagState.callrailConversationId,
                    conversationIds,
                  ),
                ),
              });
            const priorRollupByConvoId = new Map(
              existingStates.map((s) => [s.callrailConversationId, s.lastRollup]),
            );
            const now = new Date();
            for (const convo of conversationRollups) {
              const priorRollup = priorRollupByConvoId.get(convo.conversationId);
              // Only fire when a prior observation exists AND it wasn't
              // already "real" AND this run's is "real" — a conversation's
              // FIRST-EVER observation (priorRollup undefined) never fires
              // an event, it only seeds state; otherwise a client's first
              // sync (or a wide backfill) would falsely date every
              // already-Signed historical conversation as "signed today".
              if (
                priorRollup !== undefined &&
                priorRollup !== "real" &&
                convo.rollup === "real"
              ) {
                await db
                  .insert(textConversationSignedEvents)
                  .values({
                    lsaClientId,
                    callrailConversationId: convo.conversationId,
                    signedAt: now,
                  })
                  .onConflictDoNothing();
              }
              await db
                .insert(lsaTextConversationTagState)
                .values({
                  lsaClientId,
                  callrailConversationId: convo.conversationId,
                  lastRollup: convo.rollup,
                  updatedAt: now,
                })
                .onConflictDoUpdate({
                  target: [
                    lsaTextConversationTagState.lsaClientId,
                    lsaTextConversationTagState.callrailConversationId,
                  ],
                  set: { lastRollup: convo.rollup, updatedAt: now },
                });
            }
          }
        } catch (err) {
          console.error(
            `[lsa-sync] text-conversation sign-date tracking failed for lsa_client ${lsaClientId}:`,
            (err as Error).message,
          );
        }
      } catch (err) {
        console.error(
          `[lsa-sync] text-message pull failed for lsa_client ${lsaClientId}:`,
          (err as Error).message,
        );
      }

      await db
        .update(lsaClients)
        .set({ lastCallrailSyncAt: new Date(), lastSyncError: null })
        .where(eq(lsaClients.id, lsaClientId));
      await finishJob(callrailJobId, "completed", null);
    } catch (err) {
      const msg = (err as Error).message;
      callrailError = msg;
      console.error(`[lsa-sync] callrail failed for lsa_client ${lsaClientId}:`, msg);
      await finishJob(callrailJobId, "failed", msg);
      await db
        .update(lsaClients)
        .set({ lastSyncError: msg })
        .where(eq(lsaClients.id, lsaClientId));
    }
  }

  for (const row of byDate.values()) {
    const updateSet: Record<string, unknown> = { ingestedAt: new Date() };
    if (row.adsFetched) {
      updateSet.phoneCallCount = row.phoneCallCount;
      updateSet.messageCount = row.messageCount;
      updateSet.bookingCount = row.bookingCount;
      updateSet.chargedCount = row.chargedCount;
      updateSet.leadStatusBreakdown = row.statusBreakdown;
      updateSet.costMicros = row.costMicros;
    }
    if (row.callrailFetched) {
      updateSet.signedCases = row.signedCases;
      updateSet.tagCategoryBreakdown = row.tagCategoryBreakdown;
      updateSet.rollupBreakdown = row.rollupCounts;
      updateSet.firstTimeCalls = row.firstTimeCalls;
    }

    await db
      .insert(lsaLeadsDaily)
      .values({
        lsaClientId,
        date: row.date,
        phoneCallCount: row.phoneCallCount,
        messageCount: row.messageCount,
        bookingCount: row.bookingCount,
        chargedCount: row.chargedCount,
        leadStatusBreakdown: row.statusBreakdown,
        costMicros: row.costMicros,
        signedCases: row.signedCases,
        tagCategoryBreakdown: row.tagCategoryBreakdown,
        rollupBreakdown: row.rollupCounts,
        firstTimeCalls: row.firstTimeCalls,
      })
      .onConflictDoUpdate({
        target: [lsaLeadsDaily.lsaClientId, lsaLeadsDaily.date],
        set: updateSet,
      });
  }

  if (adsError && callrailError) {
    throw new Error(`google_ads: ${adsError}; callrail: ${callrailError}`);
  }

  return { daysWritten: byDate.size, adsJobId, callrailJobId, adsError, callrailError };
}

// Best-effort sweep across every active LSA client linked to at least one
// source. Per-client errors are caught; the loop continues. A client with
// only one source failing this run is still counted as synced (the other
// source's data did get written) but surfaced in `partialErrors` so it's
// not silently lost — only a client where both sources fail (or the
// client-level sync throws before either source runs) counts as `errored`.
export async function syncAllLsaClients(opts: SyncOpts): Promise<{
  synced: number;
  errored: number;
  errors: Array<{ lsaClientId: string; message: string }>;
  partialErrors: Array<{ lsaClientId: string; message: string }>;
}> {
  const candidates = await db.query.lsaClients.findMany({
    where: and(
      eq(lsaClients.isActive, true),
      sql`(${lsaClients.googleAdsCustomerId} is not null or ${lsaClients.callrailCompanyId} is not null)`,
    ),
  });
  // Clients sync concurrently (not one-at-a-time) so a wide date range
  // (e.g. a multi-month backfill) fans out instead of summing per-client
  // durations — needed to fit within a single serverless request.
  const settled = await Promise.allSettled(
    candidates.map((c) => syncLsaForClient(c.id, opts)),
  );
  let synced = 0;
  let errored = 0;
  const errors: Array<{ lsaClientId: string; message: string }> = [];
  const partialErrors: Array<{ lsaClientId: string; message: string }> = [];
  settled.forEach((s, i) => {
    const c = candidates[i];
    if (s.status === "fulfilled") {
      synced += 1;
      const result = s.value;
      if (result.adsError) {
        partialErrors.push({ lsaClientId: c.id, message: `google_ads: ${result.adsError}` });
      }
      if (result.callrailError) {
        partialErrors.push({ lsaClientId: c.id, message: `callrail: ${result.callrailError}` });
      }
    } else {
      errored += 1;
      const message = (s.reason as Error).message;
      console.error(`[lsa-sync] client ${c.id} failed entirely:`, message);
      errors.push({ lsaClientId: c.id, message });
    }
  });
  return { synced, errored, errors, partialErrors };
}
