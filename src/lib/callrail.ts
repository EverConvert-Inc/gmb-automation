// Thin wrapper around CallRail's v3 REST API. One agency-wide API key is
// stored as CALLRAIL_API_KEY; per-client mapping lives in ppc_clients
// (`callrailCompanyId` + `signedCaseTag`).

import type { CallViewRow } from "./google-ads";

const BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

function authHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return {
    Authorization: `Token token="${key}"`,
    "Content-Type": "application/json",
  };
}

type CallRailAccount = {
  id: string;
  name: string;
};

type CallRailCompany = {
  id: string;
  name: string;
  status: string;
};

type CallRailCall = {
  id: string;
  start_time: string;
  duration: number | null;
  tags: Array<{ id: number; name: string } | string> | null;
  // CallRail v3 doesn't surface a "tracker name" field directly. The closest
  // thing — and what operators actually mean by "the tracking number's
  // name" — is `source_name`, the label set on the tracking source when
  // the number was created. `formatted_tracking_source` carries the same
  // text with formatting; we read both as fallbacks.
  source_name?: string | null;
  formatted_tracking_source?: string | null;
  // Whether this is the caller's first-ever call — surfaced in CallRail's
  // own UI as the "First-Time Conversations" Call Log filter. Unverified
  // against a live response as of writing; if this field name turns out to
  // be wrong, CallRail's `fields` param 400s loudly (same as `tracker` did
  // during LSA development) rather than silently returning wrong data.
  first_call?: boolean | null;
  // The caller's own phone number (e.g. "+16787049350"), used only to
  // derive an area code for GMB ad-vs-organic matching against Google
  // Ads' call_view (see createGmbAdMatcher below). Same
  // fail-loud-if-wrong-field-name property as first_call above.
  customer_phone_number?: string | null;
};

// CallRail's "account" is the agency. Most setups have one. We list and
// pick the first; if you ever have multiple, set CALLRAIL_ACCOUNT_ID to pin.
async function resolveAccountId(): Promise<string> {
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  const res = await fetch(`${BASE_URL}/v3/a.json`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`CallRail accounts fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { accounts?: CallRailAccount[] };
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible with this API key");
  return first.id;
}

export async function listCompanies(): Promise<CallRailCompany[]> {
  const accountId = await resolveAccountId();
  const all: CallRailCompany[] = [];
  let page = 1;
  while (true) {
    const url = `${BASE_URL}/v3/a/${accountId}/companies.json?page=${page}&per_page=100`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`CallRail companies fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      companies?: CallRailCompany[];
      total_pages?: number;
    };
    for (const c of body.companies ?? []) all.push(c);
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }
  return all;
}

export type CallrailTagCategoryConfig = {
  label: string;
  callrailTagName: string;
  rollup: "real" | "junk";
};

// Per-call, not per-label — at most one of these increments per call,
// unlike tagCategoryBreakdown which increments once per matching label.
// A call with tags mapping to more than one rollup resolves by priority:
// Junk > Real > Unclassified (a junk/spam flag disqualifies a call from
// counting as Real regardless of what else is tagged on it).
//
// `unclassified` can't actually occur here: the `categories` this
// function matches against always comes from the client's *current*
// tag-category config, and every current row has a real/junk rollup by
// construction — there's no "matched label with unknown rollup" at sync
// time. `unclassified` only exists at report time, as a mismatch between
// a label stored in historical data and a category since renamed/removed
// from current config (see queries-call-quality.ts). Kept here for shape
// consistency; it will always be 0.
export type CallrailRollupCounts = {
  real: number;
  junk: number;
  unclassified: number;
};

export type CallrailChannelBucket = {
  totalCalls: number;
  firstTimeCalls: number;
  tagCategoryBreakdown: Record<string, number>;
  rollupCounts: CallrailRollupCounts;
};

export type CallrailDailyTotals = {
  date: string; // YYYY-MM-DD
  totalCalls: number;
  signedCases: number;
  firstTimeCalls: number;
  // Flat, blended across all calls that day — keyed by tagCategories[].label.
  // What LSA (no channel split) stores as-is.
  tagCategoryBreakdown: Record<string, number>;
  // Flat counterpart to tagCategoryBreakdown — see CallrailRollupCounts.
  rollupCounts: CallrailRollupCounts;
  // Populated only when gmbNameFilters is passed (PPC callers). Keyed by
  // "PPC" | "GMB" | "PMax". Null when gmbNameFilters is omitted (LSA
  // callers) — there's no channel ambiguity to split there.
  //
  // GMB and PMax share the same tracker names (e.g. "GMB - Raleigh") —
  // Google Ads' Performance Max campaigns can show sponsored pins/
  // placements on Google Maps via location assets tied to the same
  // Business Profile, so tracker-name matching alone can't tell paid PMax
  // traffic apart from organic GMB traffic. A GMB-tracker call is
  // reclassified into "PMax" instead of "GMB" when it cross-references to
  // a Google Ads call_view row (see createGmbAdMatcher below) — GMB's
  // totals reflect organic-only traffic once a call has been pulled out
  // into PMax; a call is never counted in both.
  channelBreakdown: Record<string, CallrailChannelBucket> | null;
};

// --- GMB ad-vs-organic matching (call_view cross-reference) ---
//
// Tolerances are starting values validated against exactly one confirmed
// real match (exact-second timestamp, exact-second duration, exact area
// code) — a small tolerance rather than 0 accounts for the clock/rounding
// drift risk flagged when this was scoped, but hasn't been stress-tested
// against a larger sample yet. Widen/narrow here if production matching
// turns out too strict or too loose. Exported so a diagnostic route can
// report them alongside real match deltas, rather than the audit
// silently assuming different numbers than production actually uses.
export const AD_MATCH_TIME_TOLERANCE_SECONDS = 5;
export const AD_MATCH_DURATION_TOLERANCE_SECONDS = 3;

// call_view rows can genuinely have a blank caller_area_code (confirmed
// live — Google's own call-conversion UI shows "--" for these rows too).
// Requiring an area-code match as a hard gate makes any such row
// permanently unmatchable regardless of how well timestamp/duration
// align. When call_view's row HAS an area code, it's still required to
// match (unchanged, extra confidence). When it's blank, the area-code
// check is skipped entirely and these tighter tolerances apply instead,
// to compensate for losing that confirming signal.
export const AD_MATCH_TIME_TOLERANCE_SECONDS_NO_AREA_CODE = 2;
export const AD_MATCH_DURATION_TOLERANCE_SECONDS_NO_AREA_CODE = 1;

// CallRail's customer_phone_number is expected as E.164-ish
// ("+16787049350") but we strip all non-digits and accept 10 or
// 11-digit (leading "1") US numbers defensively. Anything else (missing,
// malformed, non-US) yields "" and never matches — falls back to
// organic, the safe direction.
export function parseAreaCode(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4);
  if (digits.length === 10) return digits.slice(0, 3);
  return "";
}

// Extracts the "HH:mm:ss" local-time-of-day component from CallRail's
// start_time. NOTE: this assumes CallRail's start_time represents the
// same local wall-clock time as Google Ads' call_view.start_call_date_time
// (both in the business's account time zone) — confirmed for one real
// call via CallRail's UI call log, but not independently re-verified
// against this exact raw API field's format/offset. Worth a spot-check
// once this is live; a systematic offset here would silently bias every
// match attempt in the same direction rather than fail loudly.
export function extractLocalTimeOfDay(startTime: string): string | null {
  const m = startTime.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : null;
}

export function timeOfDaySeconds(hhmmss: string): number | null {
  const m = hhmmss.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export type GmbAdMatchResult = {
  matched: boolean;
  // "" when the caller's phone number was missing/unparseable — matching
  // was never attempted in that case.
  areaCode: string;
  // The closest same-date call_view row considered — same area code (when
  // call_view's row has one) or any area code (when call_view's row is
  // blank) — regardless of whether it actually passed tolerance or was
  // already consumed by an earlier call that day. For diagnosing whether
  // near-tolerance-edge matches (or near-misses) are inflating/deflating
  // the PMax count. Previously, a blank-area-code call_view row was
  // excluded before ever being considered a candidate at all — now it
  // shows up here like any other, so an audit can see this failure mode
  // instead of it being silently invisible. undefined only when no
  // call_view row shared the same date (and, when applicable, area code)
  // at all.
  bestCandidate?: {
    timeDeltaSeconds: number;
    durationDeltaSeconds: number;
    withinTolerance: boolean;
    alreadyConsumed: boolean;
    // Whether this candidate's call_view row had a real area code (5s/3s
    // tolerance applied) or was blank (tighter 2s/1s tolerance applied).
    callViewAreaCodeAvailable: boolean;
    campaignId: string;
    campaignName: string;
    matchedStartCallDateTime: string;
    matchedCallDurationSeconds: number;
  };
};

// Each call_view row can be consumed by at most one CallRail call — matters
// for both production (a call_view row backs exactly one PMax
// reclassification) and diagnostics (bestCandidate.alreadyConsumed
// explains why a later, otherwise-similar call fell through to GMB).
export function createGmbAdMatcher(callViewRows: CallViewRow[]) {
  const pool = callViewRows.map((row) => ({ row, consumed: false }));

  function match(
    callDate: string,
    callStartTime: string,
    callDurationSeconds: number | null,
    callerPhone: string | null | undefined,
  ): GmbAdMatchResult {
    const areaCode = parseAreaCode(callerPhone);
    if (!areaCode || callDurationSeconds === null) {
      return { matched: false, areaCode };
    }
    const localTime = extractLocalTimeOfDay(callStartTime);
    const callSeconds = localTime ? timeOfDaySeconds(localTime) : null;
    if (callSeconds === null) {
      return { matched: false, areaCode };
    }

    type Candidate = {
      entry: (typeof pool)[number];
      timeDelta: number;
      durationDelta: number;
      areaCodeAvailable: boolean;
      withinTolerance: boolean;
    };
    // Two separate "best" trackers over the same pass: `validBest` mirrors
    // the original production selection (nearest-by-time among ONLY
    // unconsumed, in-tolerance candidates — this alone decides `matched`),
    // now also accepting a blank-area-code call_view row under the
    // tighter no-area-code tolerances; `closestOverall` tracks the
    // nearest-by-time candidate regardless of consumed/tolerance status,
    // purely so an unmatched call can still report why (a near-miss
    // delta, or "the only candidate was already claimed") instead of just
    // "no match, no explanation".
    let validBest: Candidate | null = null;
    let closestOverall: Candidate | null = null;
    for (const entry of pool) {
      const areaCodeAvailable = entry.row.callerAreaCode !== "";
      // Area code is only a gate when call_view's row actually has one —
      // a blank row is still a candidate, just held to tighter tolerances
      // below instead of being excluded outright.
      if (areaCodeAvailable && entry.row.callerAreaCode !== areaCode) continue;
      const [rowDate, rowTime] = entry.row.startCallDateTime.split(" ");
      if (rowDate !== callDate || !rowTime) continue;
      const rowSeconds = timeOfDaySeconds(rowTime);
      if (rowSeconds === null) continue;
      const timeDelta = Math.abs(rowSeconds - callSeconds);
      const durationDelta = Math.abs(
        entry.row.callDurationSeconds - callDurationSeconds,
      );
      const timeTolerance = areaCodeAvailable
        ? AD_MATCH_TIME_TOLERANCE_SECONDS
        : AD_MATCH_TIME_TOLERANCE_SECONDS_NO_AREA_CODE;
      const durationTolerance = areaCodeAvailable
        ? AD_MATCH_DURATION_TOLERANCE_SECONDS
        : AD_MATCH_DURATION_TOLERANCE_SECONDS_NO_AREA_CODE;
      const withinTolerance =
        timeDelta <= timeTolerance && durationDelta <= durationTolerance;
      const candidate: Candidate = {
        entry,
        timeDelta,
        durationDelta,
        areaCodeAvailable,
        withinTolerance,
      };

      if (!closestOverall || timeDelta < closestOverall.timeDelta) {
        closestOverall = candidate;
      }
      if (entry.consumed || !withinTolerance) continue;
      if (!validBest || timeDelta < validBest.timeDelta) validBest = candidate;
    }

    const best = validBest ?? closestOverall;
    if (!best) return { matched: false, areaCode };
    const bestCandidate = {
      timeDeltaSeconds: best.timeDelta,
      durationDeltaSeconds: best.durationDelta,
      withinTolerance: best.withinTolerance,
      alreadyConsumed: best.entry.consumed,
      callViewAreaCodeAvailable: best.areaCodeAvailable,
      campaignId: best.entry.row.campaignId,
      campaignName: best.entry.row.campaignName,
      matchedStartCallDateTime: best.entry.row.startCallDateTime,
      matchedCallDurationSeconds: best.entry.row.callDurationSeconds,
    };
    if (validBest) {
      validBest.entry.consumed = true;
      return { matched: true, areaCode, bestCandidate };
    }
    return { matched: false, areaCode, bestCandidate };
  }

  return { match };
}

// Walks every call in the window and groups by (day in UTC). Signed cases =
// count of calls that (a) carry the configured tag (case-insensitive) and
// (b) come in on a tracking number whose name contains any of the configured
// substring filters (case-insensitive). An empty filter list disables (b).
// This signed-case computation is completely unchanged from before —
// tagCategories/gmbNameFilters below are additive, for the separate Ads
// Conversion Tracker x CallRail report only.
//
// tagCategories buckets each call's tags[] against the client's configured
// categories (independent of the signed-case tag/filter above — a call can
// land in multiple categories if it carries multiple matching tags).
//
// gmbNameFilters, when passed, additionally classifies each call by tracker/
// source name into "GMB" (name contains one of these substrings) or "PPC"
// (everything else) and populates channelBreakdown. Omit it (LSA callers)
// to skip channel classification entirely — lsa_leads_daily has no channel
// ambiguity to represent.
//
// We page through all results — CallRail caps per_page at 250. CallRail v3
// doesn't expose a `/companies/{id}/calls.json` endpoint; we use the
// account-scoped `/calls.json` and filter by company_id.
export async function pullCallsForCompany(
  companyId: string,
  fromDate: string,
  toDate: string,
  signedTag: string,
  nameFilters: string[],
  tagCategories: CallrailTagCategoryConfig[] = [],
  gmbNameFilters?: string[],
  // The non-GMB channel bucket's label. Defaults to "PPC" (the original,
  // only caller); LSA passes "LSA" so its own calls land under that label
  // instead of being mislabeled "PPC" when it also does GMB splitting.
  ownChannel: "PPC" | "LSA" = "PPC",
  // Pre-fetched Google Ads call_view rows (see google-ads.ts's
  // pullCallViewRows) for this client's googleAdsCustomerId, used to
  // reclassify GMB-tracker calls into PMax when ad-driven (see the
  // channelBreakdown comment on CallrailDailyTotals). Omitted entirely for
  // LSA (v1 scope is PPC-only) and for any PPC client without a
  // googleAdsCustomerId configured — every GMB-tracker call then just
  // stays "GMB" (organic), which is the safe direction to fail in (never
  // overclaims ad attribution).
  callViewRows?: CallViewRow[],
): Promise<CallrailDailyTotals[]> {
  const accountId = await resolveAccountId();
  const calls: CallRailCall[] = [];
  let page = 1;
  while (true) {
    const url = new URL(`${BASE_URL}/v3/a/${accountId}/calls.json`);
    url.searchParams.set("company_id", companyId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "250");
    url.searchParams.set("start_date", fromDate);
    url.searchParams.set("end_date", toDate);
    // CallRail v3 accepts only the documented field names — `tracker` and
    // `tracking_phone_number_name` are 400-rejected. `source_name` is the
    // tracking source label (what users typically call "the tracking
    // number's name"); `formatted_tracking_source` is the same data
    // formatted, kept as a fallback.
    url.searchParams.set(
      "fields",
      "tags,duration,source_name,formatted_tracking_source,first_call,customer_phone_number",
    );
    const res = await fetch(url.toString(), { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(
        `CallRail calls fetch failed: ${res.status} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as {
      calls?: CallRailCall[];
      total_pages?: number;
    };
    for (const c of body.calls ?? []) calls.push(c);
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }

  const wantTag = signedTag.trim().toLowerCase();
  const filtersLower = nameFilters
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);
  const gmbFiltersLower = gmbNameFilters
    ?.map((f) => f.trim().toLowerCase())
    .filter(Boolean);
  const categories = tagCategories.map((c) => ({
    label: c.label,
    tag: c.callrailTagName.trim().toLowerCase(),
    rollup: c.rollup,
  }));

  function newRollupCounts(): CallrailRollupCounts {
    return { real: 0, junk: 0, unclassified: 0 };
  }

  function newChannelBucket(): CallrailChannelBucket {
    return {
      totalCalls: 0,
      firstTimeCalls: 0,
      tagCategoryBreakdown: {},
      rollupCounts: newRollupCounts(),
    };
  }

  function matchesAnyFilter(trackerName: string, filters: string[]): boolean {
    return filters.some((f) => trackerName.includes(f));
  }

  // Junk > Real > Unclassified: a junk/spam tag disqualifies a call from
  // counting as Real regardless of what else is tagged on it. Returns
  // null (contributes to no rollup) when the call matched no configured
  // category at all — same as today's behavior for uncategorized tags.
  function resolveCallRollup(
    matched: Array<{ rollup: "real" | "junk" }>,
  ): "real" | "junk" | null {
    if (matched.some((c) => c.rollup === "junk")) return "junk";
    if (matched.some((c) => c.rollup === "real")) return "real";
    return null;
  }

  const gmbMatcher = createGmbAdMatcher(callViewRows ?? []);

  const byDate = new Map<string, CallrailDailyTotals>();
  for (const call of calls) {
    const date = call.start_time.slice(0, 10);
    const bucket = byDate.get(date) ?? {
      date,
      totalCalls: 0,
      signedCases: 0,
      firstTimeCalls: 0,
      tagCategoryBreakdown: {},
      rollupCounts: newRollupCounts(),
      channelBreakdown: gmbFiltersLower ? {} : null,
    };
    bucket.totalCalls += 1;

    const trackerName = (
      call.source_name ??
      call.formatted_tracking_source ??
      ""
    ).toLowerCase();
    const tagNames = (call.tags ?? []).map((t) =>
      typeof t === "string" ? t : t.name,
    );
    const tagNamesLower = tagNames.map((t) => t.toLowerCase());

    // Signed-case computation — unchanged from before tagCategories/
    // gmbNameFilters existed. Empty filtersLower still means "no
    // restriction" here — this gate's behavior is untouched.
    const hasTag = tagNamesLower.some((t) => t === wantTag);
    if (hasTag) {
      const nameMatches =
        filtersLower.length === 0 || matchesAnyFilter(trackerName, filtersLower);
      if (nameMatches) bucket.signedCases += 1;
    }

    const matchedCategories = categories.filter((c) =>
      tagNamesLower.includes(c.tag),
    );
    const matchedCategoryLabels = matchedCategories.map((c) => c.label);
    const isFirstTime = call.first_call === true;

    // Ads Conversion Tracker x CallRail metrics (tag category rollup,
    // first-time calls, channel split) — pullCallsForCompany queries by
    // company_id only, so `calls` includes every call under the whole
    // CallRail company, not just calls on this client's tracked numbers.
    // Unlike signedCases above, these metrics are gated on the call
    // actually matching a configured tracker-name filter, and an EMPTY
    // filter list means "exclude everything" here (not "no
    // restriction") — a client with no filters configured yet gets an
    // honestly-empty report instead of silently absorbing every call in
    // the CallRail company.
    const isRelevantForReport = matchesAnyFilter(trackerName, filtersLower);
    if (isRelevantForReport) {
      if (isFirstTime) bucket.firstTimeCalls += 1;
      // Tag category rollup is scoped to first-time calls only, same
      // population as firstTimeCalls itself — otherwise Real/Junk/
      // Unclassified are counted over a different (larger, repeat-caller-
      // inclusive) population than firstTimeCalls, and can exceed it,
      // which is exactly the confusing "two unrelated stats" behavior
      // this scoping fixes. A repeat caller's tagged call still counts
      // toward totalCalls/signedCases above, just not toward these.
      if (isFirstTime) {
        for (const label of matchedCategoryLabels) {
          bucket.tagCategoryBreakdown[label] =
            (bucket.tagCategoryBreakdown[label] ?? 0) + 1;
        }
        const rollup = resolveCallRollup(matchedCategories);
        if (rollup) bucket.rollupCounts[rollup] += 1;
      }
    }

    // Channel classification — only when the caller asked for it (PPC
    // always does; LSA does only when it owns GMB for this company — see
    // lsa-sync.ts). Same "must actually match a filter" gate as above: GMB
    // filters win first, then the caller's own-channel filters checked
    // above; a call matching neither is out of scope entirely, not
    // silently counted under the caller's own channel.
    //
    // A GMB-tracker call is further split into "GMB" (organic) vs "PMax"
    // (ad-driven) by cross-referencing Google Ads' call_view — GMB and
    // PMax share the same tracker name, so this is the only way to tell
    // them apart (see createGmbAdMatcher above and CallrailDailyTotals'
    // channelBreakdown comment). Unscoped by first_call — ad-attribution
    // is a traffic-source property of the call itself, not a call-quality
    // classification, so a repeat caller's GMB/PMax call is still
    // reclassified the same way a first-time one would be.
    if (bucket.channelBreakdown) {
      const isGmbTracker =
        !!gmbFiltersLower?.length && matchesAnyFilter(trackerName, gmbFiltersLower);
      let channel: "GMB" | "PPC" | "LSA" | "PMax" | null;
      if (isGmbTracker) {
        const matchResult = gmbMatcher.match(
          date,
          call.start_time,
          call.duration,
          call.customer_phone_number,
        );
        channel = matchResult.matched ? "PMax" : "GMB";
      } else if (isRelevantForReport) {
        channel = ownChannel;
      } else {
        channel = null;
      }
      if (channel) {
        const channelBucket =
          bucket.channelBreakdown[channel] ?? newChannelBucket();
        channelBucket.totalCalls += 1;
        if (isFirstTime) channelBucket.firstTimeCalls += 1;
        // Same first-time-only scoping as the flat block above.
        if (isFirstTime) {
          for (const label of matchedCategoryLabels) {
            channelBucket.tagCategoryBreakdown[label] =
              (channelBucket.tagCategoryBreakdown[label] ?? 0) + 1;
          }
          const rollup = resolveCallRollup(matchedCategories);
          if (rollup) channelBucket.rollupCounts[rollup] += 1;
        }
        bucket.channelBreakdown[channel] = channelBucket;
      }
    }

    byDate.set(date, bucket);
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
