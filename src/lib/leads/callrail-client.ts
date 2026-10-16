// The lead tracker's OWN CallRail client. Nothing here is shared with
// src/lib/callrail.ts, deliberately.
//
// CallRail rejects an entire request when the `fields` parameter names a
// field it does not know — a 400, not a silent null. So widening the shared
// pullCallsForCompany's field list to serve this would risk 400-ing the
// production PPC and LSA syncs on every run. A separate client with its own
// field list can only ever break itself.
//
// The ~10 lines of resolveAccountId are duplicated from callrail.ts for the
// same reason: exporting it there would mean editing a do-not-touch file,
// and duplicating it means this client's 429 backoff wraps its own account
// lookup too, which a shared export would not give us.

import { OPPORTUNITY_TAG, STATUS_TAG_LADDER } from "./status-from-tags";

const BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

/**
 * Only records carrying one of these are pulled at all.
 *
 * The first dry run fetched 790 calls for one company and 772 of them had no
 * note whatsoever — they were tagged Client, Admin, Duplicate or nothing,
 * i.e. not leads. Ingesting them would have put ~97% of a month's calls in
 * the admin queue as parse failures and buried the real ones. A tag is what
 * marks a record as a triaged lead, so the tag is where the filter belongs,
 * and it belongs server-side: filtering after the fetch would still pull
 * every caller's name and number for records we then discard.
 *
 * DERIVED from the status ladder rather than hand-listed, so the set of tags
 * that makes a record a lead and the set that gives it a status cannot drift
 * apart. The exact nine are pinned by test.
 */
export const LEAD_STATUS_TAGS: readonly string[] = [
  OPPORTUNITY_TAG,
  ...STATUS_TAG_LADDER,
];

function authHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return {
    Authorization: `Token token="${key}"`,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Field lists
// ---------------------------------------------------------------------------

// UNVERIFIED against a live response in this account. The dry-run mode on
// both routes exists to check these before any cron is registered: a wrong
// name here 400s the whole request.
export const CALLRAIL_TRACKER_CALL_FIELDS = [
  "id",
  "company_name",
  "customer_name",
  "customer_phone_number",
  "source_name",
  "formatted_tracking_source",
  "tracker_id",
  "start_time",
  "tags",
  "note",
] as const;

export const CALLRAIL_TRACKER_FORM_FIELDS = [
  "note",
  "tags",
  "customer_name",
  "customer_phone_number",
  "form_data",
  "source",
  "referrer",
  "submitted_at",
  "company_name",
] as const;

// ---------------------------------------------------------------------------
// Transport: retry, backoff, concurrency
// ---------------------------------------------------------------------------

export type TransportOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** How many companies are fetched at once. */
  concurrency?: number;
};

export type FetchOptions = TransportOptions & {
  /**
   * Tag filter sent as repeated tags[] params. Defaults to
   * LEAD_STATUS_TAGS; pass null to fetch unfiltered, which only the
   * semantics probe below does.
   */
  tags?: readonly string[] | null;
};

const DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  concurrency: 3,
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function backoffDelayMs(attempt: number, opts: TransportOptions): number {
  const base = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const max = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const exponential = base * 2 ** (attempt - 1);
  // Full jitter. Without it, a batch of companies that all hit the limit at
  // once would retry in lockstep and hit it again together.
  return Math.min(max, Math.round(Math.random() * exponential));
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

/**
 * Retries 429 and 5xx. 429 is the one this exists for — the shared client
 * has no rate-limit handling at all and we share one agency-wide API key
 * with the production PPC and LSA syncs, so this client backing off is what
 * keeps it from spending their budget. 5xx is included because a transient
 * gateway error is the same class of problem; 4xx other than 429 is not
 * retried, since a bad field name will fail identically forever.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: TransportOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
  const sleep = opts.sleep ?? realSleep;

  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    lastStatus = res.status;
    if (attempt === maxAttempts) return res;
    const wait = retryAfterMs(res) ?? backoffDelayMs(attempt, opts);
    await sleep(wait);
  }
  // Unreachable: the loop returns on its final attempt.
  throw new Error(`CallRail request to ${url} gave up after ${lastStatus}`);
}

/** Runs `fn` over `items` with at most `limit` in flight. Order is preserved. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getJson<T>(url: string, opts: TransportOptions): Promise<T> {
  const res = await fetchWithRetry(url, { headers: authHeaders() }, opts);
  if (!res.ok) {
    throw new Error(
      `CallRail request failed: ${res.status} ${await res.text()} (${url})`,
    );
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

type CallRailAccount = { id: string; name: string };

let cachedAccountId: string | null = null;

/** Duplicated from callrail.ts — see the file header for why. */
export async function resolveTrackerAccountId(
  opts: TransportOptions = {},
): Promise<string> {
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  if (cachedAccountId) return cachedAccountId;
  const body = await getJson<{ accounts?: CallRailAccount[] }>(
    `${BASE_URL}/v3/a.json`,
    opts,
  );
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible with this API key");
  cachedAccountId = first.id;
  return first.id;
}

/** Test seam only — the account id is cached for the life of the process. */
export function resetTrackerAccountIdCache(): void {
  cachedAccountId = null;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type CallRailTag = string | { name?: string | null };

export type TrackerCallRecord = {
  id: string;
  company_name?: string | null;
  customer_name?: string | null;
  customer_phone_number?: string | null;
  source_name?: string | null;
  formatted_tracking_source?: string | null;
  tracker_id?: string | null;
  start_time?: string | null;
  tags?: CallRailTag[] | null;
  note?: string | null;
};

export type TrackerFormRecord = {
  id: string;
  company_name?: string | null;
  customer_name?: string | null;
  customer_phone_number?: string | null;
  form_data?: Record<string, unknown> | null;
  source?: string | null;
  referrer?: string | null;
  submitted_at?: string | null;
  tags?: CallRailTag[] | null;
  note?: string | null;
};

export function tagNames(tags: CallRailTag[] | null | undefined): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const name = typeof t === "string" ? t : t?.name;
    if (typeof name === "string" && name.trim()) out.push(name.trim());
  }
  return out;
}

type CompanyRecord = { id: string; name?: string | null; status?: string | null };

/**
 * Every company in the account, not only the ones mapped to a firm.
 *
 * Routing rule 3 (the admin queue) is only reachable for leads from an
 * UNMAPPED company, so narrowing this to lead_firm_callrail_companies would
 * make "unassigned" unreachable and an operator would never learn that a new
 * company needs mapping. The cost is that caller names and phone numbers
 * from companies with no tracker firm also land at rest — called out in the
 * Phase 3 hand-off, and narrowed by passing an explicit company list to the
 * sync if that trade is not wanted.
 */
export async function listTrackerCompanyIds(
  opts: TransportOptions = {},
): Promise<string[]> {
  const accountId = await resolveTrackerAccountId(opts);
  const ids: string[] = [];
  let page = 1;
  while (true) {
    const url = `${BASE_URL}/v3/a/${accountId}/companies.json?page=${page}&per_page=100`;
    const body = await getJson<{ companies?: CompanyRecord[]; total_pages?: number }>(
      url,
      opts,
    );
    for (const c of body.companies ?? []) {
      if (c.status && c.status.toLowerCase() === "disabled") continue;
      ids.push(c.id);
    }
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }
  return ids;
}

export type TrackerCompany = { id: string; name: string | null; disabled: boolean };

/**
 * Every company in the account WITH its name and status, for the admin
 * firm page's company picker. Separate from listTrackerCompanyIds (which the
 * sync uses and which skips disabled companies) so the sync path is
 * unchanged. `signal` lets the caller put a hard time limit on the whole
 * listing, retries included.
 */
export async function listTrackerCompanies(
  opts: TransportOptions & { signal?: AbortSignal } = {},
): Promise<TrackerCompany[]> {
  const accountId = await resolveTrackerAccountId(opts);
  const out: TrackerCompany[] = [];
  let page = 1;
  while (true) {
    const url = `${BASE_URL}/v3/a/${accountId}/companies.json?page=${page}&per_page=100`;
    const res = await fetchWithRetry(url, { headers: authHeaders(), signal: opts.signal }, opts);
    if (!res.ok) throw new Error(`CallRail companies request failed: ${res.status}`);
    const body = (await res.json()) as { companies?: CompanyRecord[]; total_pages?: number };
    for (const c of body.companies ?? []) {
      if (!c?.id) continue;
      out.push({
        id: c.id,
        name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : null,
        disabled: !!c.status && c.status.toLowerCase() === "disabled",
      });
    }
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }
  return out;
}

// CallRail caps per_page at 250 (see the shared client's own comment).
const PER_PAGE = 250;

async function pagedFetch<T>(
  path: string,
  key: "calls" | "form_submissions",
  companyId: string,
  fromDate: string,
  toDate: string,
  fields: readonly string[],
  opts: FetchOptions,
): Promise<T[]> {
  const accountId = await resolveTrackerAccountId(opts);
  const out: T[] = [];
  let page = 1;
  while (true) {
    const url = new URL(`${BASE_URL}/v3/a/${accountId}/${path}`);
    url.searchParams.set("company_id", companyId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PER_PAGE));
    applyTagFilter(url, opts);
    // CallRail interprets these in the ACCOUNT's local time (Eastern here),
    // not UTC — which is why every caller passes a date produced by
    // date-utils' Eastern helpers and never toISOString().slice(0, 10).
    url.searchParams.set("start_date", fromDate);
    url.searchParams.set("end_date", toDate);
    url.searchParams.set("fields", fields.join(","));
    const body = await getJson<Record<string, unknown>>(url.toString(), opts);
    const rows = (body[key] as T[] | undefined) ?? [];
    for (const r of rows) out.push(r);
    const totalPages = body.total_pages as number | undefined;
    if (!totalPages || page >= totalPages) break;
    page += 1;
  }
  return out;
}

/**
 * Appends one tags[] param per tag. The dashboard automation does the same
 * and relies on OR semantics; probeTagFilterSemantics exists because that is
 * an assumption about CallRail's API, not something the docs settle.
 */
function applyTagFilter(url: URL, opts: FetchOptions): void {
  const tags = opts.tags === null ? [] : (opts.tags ?? LEAD_STATUS_TAGS);
  for (const tag of tags) url.searchParams.append("tags[]", tag);
}

export function fetchCallsForCompany(
  companyId: string,
  fromDate: string,
  toDate: string,
  opts: FetchOptions = {},
): Promise<TrackerCallRecord[]> {
  return pagedFetch<TrackerCallRecord>(
    "calls.json",
    "calls",
    companyId,
    fromDate,
    toDate,
    CALLRAIL_TRACKER_CALL_FIELDS,
    opts,
  );
}

export function fetchFormSubmissionsForCompany(
  companyId: string,
  fromDate: string,
  toDate: string,
  opts: FetchOptions = {},
): Promise<TrackerFormRecord[]> {
  return pagedFetch<TrackerFormRecord>(
    "form_submissions.json",
    "form_submissions",
    companyId,
    fromDate,
    toDate,
    CALLRAIL_TRACKER_FORM_FIELDS,
    opts,
  );
}

// ---------------------------------------------------------------------------
// Tag-filter semantics probe (dry run only)
// ---------------------------------------------------------------------------

/**
 * Reads total_records off a single-record page, so a count costs one request
 * instead of paging the whole result.
 */
async function countRecords(
  path: string,
  companyId: string,
  fromDate: string,
  toDate: string,
  tags: readonly string[] | null,
  opts: TransportOptions,
): Promise<number | null> {
  const accountId = await resolveTrackerAccountId(opts);
  const url = new URL(`${BASE_URL}/v3/a/${accountId}/${path}`);
  url.searchParams.set("company_id", companyId);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "1");
  url.searchParams.set("start_date", fromDate);
  url.searchParams.set("end_date", toDate);
  url.searchParams.set("fields", "id");
  applyTagFilter(url, { ...opts, tags });
  const body = await getJson<Record<string, unknown>>(url.toString(), opts);
  const total = body.total_records;
  return typeof total === "number" ? total : null;
}

export type TagFilterSemantics = "or" | "and" | "ignored" | "inconclusive";

export type TagFilterProbe = {
  companyId: string;
  path: string;
  unfiltered: number | null;
  singleTag: number | null;
  singleTagName: string;
  allTags: number | null;
  semantics: TagFilterSemantics;
  explanation: string;
};

export function inferTagFilterSemantics(
  unfiltered: number | null,
  singleTag: number | null,
  allTags: number | null,
): { semantics: TagFilterSemantics; explanation: string } {
  if (unfiltered === null || singleTag === null || allTags === null) {
    return {
      semantics: "inconclusive",
      explanation: "CallRail did not return total_records for one of the probes.",
    };
  }
  // The filter being silently dropped is the dangerous outcome: it would
  // look like it worked while ingesting every untagged record.
  if (unfiltered > 0 && allTags === unfiltered && singleTag < unfiltered) {
    return {
      semantics: "ignored",
      explanation:
        "All-tags count equals the unfiltered count while a single tag returns fewer — the tags[] filter is being ignored.",
    };
  }
  if (allTags < singleTag) {
    return {
      semantics: "and",
      explanation:
        "All-tags returned FEWER than a single tag, so tags[] intersects rather than unions. One request per tag, merged locally, is the fallback.",
    };
  }
  if (singleTag === 0 && allTags === 0) {
    return {
      semantics: "inconclusive",
      explanation:
        "No record in this window carries any status tag, so OR and AND are indistinguishable here. Re-probe on a company and month that has tagged records.",
    };
  }
  return {
    semantics: "or",
    explanation:
      "All-tags is at least the single-tag count and no more than the unfiltered count, which is what OR looks like.",
  };
}

/**
 * Three one-record requests: unfiltered, one tag, all nine. Dry run only.
 */
export async function probeTagFilterSemantics(
  kind: "calls" | "forms",
  companyId: string,
  fromDate: string,
  toDate: string,
  opts: TransportOptions = {},
): Promise<TagFilterProbe> {
  const path = kind === "calls" ? "calls.json" : "form_submissions.json";
  const singleTagName = LEAD_STATUS_TAGS[0];
  const [unfiltered, singleTag, allTags] = await Promise.all([
    countRecords(path, companyId, fromDate, toDate, null, opts),
    countRecords(path, companyId, fromDate, toDate, [singleTagName], opts),
    countRecords(path, companyId, fromDate, toDate, LEAD_STATUS_TAGS, opts),
  ]);
  const { semantics, explanation } = inferTagFilterSemantics(
    unfiltered,
    singleTag,
    allTags,
  );
  return {
    companyId,
    path,
    unfiltered,
    singleTag,
    singleTagName,
    allTags,
    semantics,
    explanation,
  };
}

export function trackerConcurrency(opts: TransportOptions = {}): number {
  return opts.concurrency ?? DEFAULTS.concurrency;
}
