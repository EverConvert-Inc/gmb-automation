# gmb-automation — Local Visibility Platform

Internal reporting/automation platform for EverConvert. Tracks Google Business Profile
health, PPC (Google Ads) and LSA (Local Services Ads) spend/lead performance, CallRail
call attribution, organic SERP rankings, and local-pack grid visibility across every
client, with daily automated syncs and email/PDF reports.

**Read this file as a map, not a source of truth.** It documents structure, conventions,
and gotchas that shouldn't change often — not current numbers, current bug status, or
anything else likely to drift. Several real bugs in this codebase's history came from
trusting a stale assumption about what a field or column contained instead of checking
the live code/data. Before relying on a specific claim here (a field name, a table
shape, whether something is "already fixed"), verify against the actual code or a live
query — this file tells you where to look, not what's true today.

Stack: Next.js App Router, Drizzle ORM, Postgres (Supabase), Vercel (hosting + cron).
No DB or Vercel CLI access is available in most dev/agent environments — real data
comes from asking the user to run a SQL query and paste the result back.

## Site map

| Route | Purpose |
|---|---|
| `/clients`, `/clients/[slug]`, `/clients/[slug]/locations/[locationId]` | GBP/geo-grid product: client roster, per-client dashboard (reviews, rankings, heat map, scans), per-location detail |
| `/rankings` | Cross-client organic SERP rankings overview |
| `/ppc`, `/ppc/clients/*` | Google Ads + CallRail PPC reporting |
| `/lsa`, `/lsa/clients/*` | Local Services Ads reporting (same shape as PPC) |
| `/call-quality` | Cross-channel (PPC+LSA+GMB+PMax) call-quality view — read-only, no sync of its own |
| `/reddit`, `/reddit/accounts` | Reddit Ads daily spend report — standalone, never merged into PPC/LSA |
| `/scans` | Cross-client grid/local-pack scan history |
| `/takedowns` | Confirmed review takedown alerts, for filing reinstatement requests |
| `/settings` | Report-recipient management (PPC/LSA/Call Quality/PPC-alert) |
| `/login` | Supabase auth, full-bleed (no sidebar) |

Sidebar nav (`src/components/sidebar.tsx`) is the authoritative top-level index — add
new pages there too. `/clients/[slug]` does **not** pull in PPC or LSA data; those are
entirely separate sections keyed by their own client tables, unrelated by FK to
`clients`/`locations`.

## Auth model

`src/middleware.ts` → `src/lib/supabase/middleware.ts` refreshes the Supabase session
on every request except static assets, then requires a logged-in user or redirects to
`/login`. Exempt by pathname prefix: `/login`, `/api/scans/postback` (DataForSEO
webhook), `/api/cron/**` (Vercel cron), `/api/webhooks/**` (e.g. CallRail's
call-modified webhook) — these verify their own caller instead (CRON_SECRET bearer
header, or HMAC/token checks in `src/lib/crypto.ts`). No role/permission tiers —
authenticated internal user or not; RLS is explicitly deferred.

## Time handling

CallRail's date filters and Google Ads' GAQL date fields are both interpreted in
**account-local time (Eastern)**, not UTC. `src/lib/date-utils.ts` computes all
"today"/"yesterday"/"N days ago" values via `Intl.DateTimeFormat` with the
`America/New_York` IANA zone (DST-correct automatically), never naive UTC arithmetic.
The documented risk window for getting this wrong is roughly 00:00–05:00 UTC (before
Eastern midnight has passed) — the fixed daily crons never hit that window, but a
manual "Sync Now" click at any time of day could.

**Vercel cron has no timezone support** — every schedule in `vercel.json` is a plain
UTC cron expression, hand-picked to land at a target Eastern time assuming EDT. This
has already caused real drift more than once: during EST (winter), every cron fires
an hour earlier in local time than during EDT (summer), and nobody has automated the
fix. Whoever touches `vercel.json` around the March/November DST transitions needs to
manually rebalance every affected schedule (±1 hour) and update the matching
human-readable time comments in the corresponding route files and any UI strings
(report-recipient cards) that state a landing time — those have gone stale before.

## PPC / LSA sync & reporting pipeline

Two data sources, two report surfaces:

- **CallRail** — single global agency API key (`CALLRAIL_API_KEY`), call/message data
  pulled per CallRail `company_id`. Wrapper: `src/lib/callrail.ts`.
- **Google Ads** — per-client OAuth (encrypted refresh token in `oauth_credentials`,
  referenced by `googleAdsOauthTokenId`). Spend/clicks/conversions via `campaign` GAQL,
  LSA leads via `local_services_lead`, LSA cost via `campaign` filtered to
  `LOCAL_SERVICES`, and `call_view` for ad-attribution cross-referencing. Wrapper:
  `src/lib/google-ads.ts`.

**PPC** (`src/lib/ppc-sync.ts`): two independent per-source sync functions
(`syncGoogleAdsForClient`, `syncCallrailForClient`), each with its own `ppc_sync_jobs`
row. Google Ads writes `ppc_campaigns` (dimension) + `ppc_ads_daily` (facts, unique on
campaign+date). CallRail writes `ppc_callrail_daily` (unique on client+date) — these
are two separate tables joined at report-query time, not merged at sync time.

**LSA** (`src/lib/lsa-sync.ts`): a single `syncLsaForClient` bundles both sources into
one merged fact table, `lsa_leads_daily` (one row per client/date), specifically to
avoid PPC's join-drop failure mode. Each source still fails independently — a
transient failure on one side never overwrites previously-good data from the other.
LSA also layers a "true sign date" correction (`call_signed_events`, fed by a CallRail
webhook) that redirects a call's signed/real classification to the date it was
*actually* tagged, not the date the call happened. PPC has no equivalent.

**Call attribution**: CallRail's per-call channel (PPC/GMB/PMax) isn't decided by
tracker name alone — tracker naming can't reliably separate ad-driven traffic from
organic, since PMax can serve through the same Business Profile as organic GMB. Any
in-scope call is cross-referenced against Google Ads' `call_view` resource by
timestamp/duration/area-code matching (`createGmbAdMatcher` in `callrail.ts`); the
matched campaign's `advertising_channel_type` decides the channel
(`PERFORMANCE_MAX` → "PMax", anything else ad-driven → "PPC"), overriding tracker-name
classification. A non-match falls back to tracker-name classification.

**Durable invariants worth knowing before touching this code:**

- `campaign.status` in GAQL reflects the campaign's *current* status, not its status on
  the historical date being queried. Filtering `WHERE campaign.status = 'ENABLED'`
  alongside a `segments.date` range silently drops real historical spend from any
  campaign paused/removed since. `pullDailyMetrics`, `pullLocalServicesCost`, and
  `pullCallViewRows` in `google-ads.ts` all deliberately omit this filter — each was
  a real, live-confirmed data-loss bug (for `call_view`, the filter was dropping the
  majority of historical rows for many clients). Never re-add it to a query that
  spans historical dates.
- `pullCallViewRows` is capped at `LIMIT 1000` (newest first) and real accounts can
  hit that cap — a warn-log fires when it does. `segments.date` is rejected on
  call_view, but `call_view.start_call_date_time` is filterable per the v25 docs
  (untested live) — switch to a date filter if a backfill ever needs >1000 records
  per client.
- `signedCases` sums `real` across every channel **except GMB** (GMB is organic,
  excluded by definition) — PMax is included, since PMax's ad spend was never split
  out of PPC's own cost figure, so excluding PMax's signed cases would understate cases
  against a cost total that still includes PMax spend.
- `totalCalls` counts every call including repeats; `firstTimeCalls` (CallRail's
  `first_call` flag) is the "genuine new lead" population that tag-category counts are
  scoped to. `real`/signed-case counts are deliberately *not* scoped to first-time only
  — a Signed tag can land on a repeat call. Don't conflate the two when reading a
  "calls" number anywhere in this codebase — check which field it's actually summing.
- CallRail data (`ppc_callrail_daily`) is per-client-per-day, never per-campaign — any
  UI showing a per-campaign "calls" number is necessarily displaying a duplicated
  client-level total, not a real breakdown.
- `pullCallsForCompany` queries by CallRail `company_id` only, returning every call in
  that company regardless of client — `nameFilters`/`gmbNameFilters` gate what counts
  toward a given client's report, and an empty filter list means "exclude everything,"
  not "no restriction."
- When an LSA client's CallRail company also has a matching `ppc_clients` row, GMB
  classification is owned exclusively by the PPC side, to avoid double-counting the
  same calls under two client rows.
- `tagCategoryBreakdown`/`rollupBreakdown` jsonb columns (on both `ppc_callrail_daily`
  and `lsa_leads_daily`) can be either flat or channel-nested (keyed "PPC"/"GMB"/
  "PMax"/"LSA") — downstream code must detect which shape it's looking at (convention:
  nested iff some value is itself an object). This duality is repeated in several
  places and must stay consistent if touched.
- Every caught sync error should be routed through a `stringifyError` helper, not a
  bare `(err as Error).message` cast — a non-Error rejection cast that way produces
  `undefined`, which Drizzle's `.set({ field: undefined })` silently treats as "no
  fields to update" and throws a masking error that hides the real cause. This was a
  real production incident.

## Call Quality

`/call-quality` (`src/lib/queries-call-quality.ts`) is a **read-only cross-channel
view with no sync of its own** — it has no direct CallRail/Google Ads calls and no
daily-fact table. It reads the same `ppc_callrail_daily`/`lsa_leads_daily` rows
PPC/LSA's own syncs already wrote, splitting them into four channels: PPC, LSA, GMB,
PMax. Its "sync now" button is a thin wrapper that just re-triggers PPC's and LSA's
own sync functions.

PMax calls are pulled entirely out of PPC's own numbers via `call_view` matching, but
PMax's ad spend is never isolated — it stays inside PPC's own cost figure. This makes
PPC's own "cost per signed lead" look artificially worse once some real leads move to
PMax's bucket while the cost stays behind; a combining helper
(`call-quality-combined.ts`) recovers the true effective CPL. The UI groups PPC+PMax
into one section for this reason while still breaking out separate per-client tables.

Internal field names (`real`/`junk`/`unclassified`) have stayed stable; the *display
label* has changed more than once (was "Real", is currently "Signed" everywhere) —
don't assume the field name and the UI label always match, and expect the label could
move again.

`/ppc`'s own "Phone calls" is expected to equal Call Quality's combined PPC+PMax
`firstTimeCalls` for the same range (both read the same GMB-excluded channel data);
GMB's calls are never counted in either, by design.

## Reddit Ads

`/reddit` (`src/lib/queries-reddit.ts`) is a **standalone spend report**: own tables
(`reddit_clients`, `reddit_ad_accounts`, `reddit_ads_daily`, `reddit_sync_jobs`), own
sync (`src/lib/reddit-sync.ts`, cron `reddit-ads-sync`), no FK into
`ppc_clients`/`lsa_clients`, and nothing feeds PPC/LSA totals. A test asserts the
Reddit data code imports nothing from the PPC/LSA/Google Ads modules.

- **One agency-wide OAuth login** (`oauth_credentials`, provider `reddit_ads`,
  `account_email` holds the Reddit *username*), connected at `/reddit/accounts`.
  `src/lib/reddit-ads.ts` is the pure API client; `reddit-ads-token.ts` caches and
  refreshes the access token.
- **Discovery must union two endpoints.** `GET /businesses/{id}/ad_accounts` omits
  partner-shared accounts — confirmed live, it returned only our own account while
  `POST /businesses/{id}/ad_accounts/query` also returned every shared client account.
- **Client mapping lives on the account row** (`reddit_client_id`, many accounts → one
  client), and facts are stored per account, so remapping needs no resync.
- **Every report is requested in America/New_York**, window bounded at Eastern
  midnights *and* `time_zone_id` Eastern (which one Reddit uses to cut days was never
  tested; both agree this way). Stored dates are Eastern dates. The cron re-pulls the
  last 3 days since Reddit metrics settle for up to 6h; a sync zero-fills its window
  so a day that dropped to $0 overwrites stale spend.
- **USD only**: non-USD accounts still sync but are flagged and excluded from every
  total.

## Rankings & Scans

Two parallel, independently-triggered systems sharing one DataForSEO account:

- **Rankings** (`src/lib/serp-scan.ts`) — organic SERP position tracking, keyword-based
  (`tracked_keywords` → `serp_rankings`), synchronous API calls, weekly cron + manual
  trigger. Checks both the keyword as-typed and a city-stripped "bare" version at the
  same geo point.
- **Scans** (`src/lib/scans.ts`) — grid/local-pack map visibility, place-based
  (`locations`/`keywords`/`grid_configs` → `scans`/`scan_points`), **async task+postback**
  (DataForSEO calls back with results), **manual-only, no cron**. Grid sizes are
  restricted to an odd allowlist so there's always a center point; cost scales
  quadratically with grid size and linearly with keyword count.

DataForSEO is billed **pay-per-API-call, not a flat subscription** — the account
balance can and has been drawn to zero. A sidebar "SEO API spend" widget
(`src/lib/dataforseo-spend.ts`) exists specifically as an early-warning indicator,
derived by diffing lifetime spend against a month-start anchor snapshot (DataForSEO
exposes no "spent this month" field directly).

## GBP, reviews, and takedowns

GBP OAuth is per-location; `oauth_credentials` rows are deduped on
`(provider, accountEmail)` so many locations can share one connected Google account.
`src/lib/gbp.ts` is a pure API client with no DB access.

Review polling (`src/lib/reviews.ts`, cron: `poll-reviews`) does a **full sweep every
time**, not incremental — required for takedown detection (a still-present-but-
unchanged review would never resurface under an incremental fetch). Per-location
cadence and failure backoff are both driven by a single `nextPollAfter` field, not by
counting cron invocations.

Takedown detection tracks how long a review has been continuously absent
(`missingSinceAt`), confirming after a fixed window — elapsed time, not poll count,
since poll cadence varies per location. A **partial-sweep guard** exists because GBP's
review API has a confirmed, real failure mode: a sweep can return HTTP success while
silently returning fewer reviews than actually exist, which has previously caused
false-positive takedowns across unrelated locations. A sweep must drop both a
percentage and an absolute-count threshold (plus a special case for small locations)
before anything gets marked missing. A retry-and-merge step also re-fetches and unions
results when a sweep looks short, since two successive reads of GBP's legacy v4 API
have been confirmed to return different totals seconds apart.

`review_takedown_alerts` uses a partial unique index (`reviewId WHERE status <>
'resolved'`), not a plain unique — so a review can be re-alerted after a prior alert
(including a resolved false positive) is resolved.

## Repeated architectural patterns

- **`*_sync_jobs` table pattern**: one row per sync attempt (`ppc_sync_jobs`,
  `lsa_sync_jobs`), tracking `status`/`startedAt`/`completedAt`/`errorMessage`/
  `triggeredBy` (`scheduled` vs `manual`), nullable client FK (null = "sync all" cron
  run).
- **"Sync Now" button pattern**: a client component POSTs to a dedicated API route
  that re-invokes the *same* sync function the cron uses, scoped to whatever date
  range the page's filter currently shows, then calls `router.refresh()` since the
  report is server-rendered and only fetched once at page load. Auth rides on the
  normal Supabase middleware gate, not a separate secret.
- **Temporary diagnostic-route pattern**: routes under `/api/cron/*-test*` or
  `*-audit*` are CRON_SECRET-gated like real crons but deliberately **not** registered
  in `vercel.json` — they exist to verify an unfamiliar third-party API field/shape
  against a live account before real sync logic gets built on top of an assumption.
  Each should be read-only and is meant to be deleted once its question is answered.
  If you find one still present, its existence and any specific findings/test account
  IDs it references are not durable facts — treat them as of unknown age.
- **Daily-rollup convention**: `date` column + `unique(clientId, date)` (or
  `unique(campaignId, date)`) = one row per entity per day, upserted by the sync job.

## Environment / credentials (names only — check `.env.example` for details)

`DATABASE_URL` · `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` · `GOOGLE_PLACES_API_KEY` · `GOOGLE_OAUTH_CLIENT_ID` /
`GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` (GBP OAuth) ·
`GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_OAUTH_CLIENT_ID` /
`GOOGLE_ADS_OAUTH_CLIENT_SECRET` (falls back to the GBP OAuth client if unset) /
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` (PPC MCC) / `GOOGLE_ADS_LSA_MANAGER_ID` (LSA MCC
override) · `CALLRAIL_API_KEY` / `CALLRAIL_ACCOUNT_ID` / `CALLRAIL_API_BASE` ·
`REDDIT_ADS_APP_ID` / `REDDIT_ADS_APP_SECRET` / `REDDIT_ADS_REDIRECT_URI` /
`REDDIT_ADS_USER_AGENT` (required; Reddit throttles default UAs) ·
`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` / `DATAFORSEO_POSTBACK_URL` /
`DATAFORSEO_POSTBACK_SECRET` · `SLACK_WEBHOOK_URL` · `RESEND_API_KEY` ·
`CRON_SECRET` (also gates diagnostic routes) · `ENCRYPTION_KEY` (AES-256-GCM,
encrypts OAuth refresh tokens at rest — see `src/lib/crypto.ts`).

LSA clients carry their own per-client `loginCustomerId` column, separate from PPC's
global MCC env var, since LSA MCCs are typically different accounts from PPC's.

## Design system

Tailwind with `darkMode: "class"` (via `next-themes`), driven by CSS custom
properties in `src/app/globals.css` (HSL triplets under `:root`/`.dark`) mapped to
Tailwind colors in `tailwind.config.ts`. The `brand.dark`/`brand.dark-foreground`
tokens use `<alpha-value>` interpolation (not bare `hsl(var(...))`) so opacity
modifiers work — the sidebar background token flips from white (light mode) to
near-black (dark mode) rather than staying a fixed color. A separate `rank` color
family (excellent/good/fair/poor/none) is fixed-hex and doesn't theme.

## Verifying instead of assuming

This codebase has a real, repeated pattern: an assumption about a third-party field's
name or behavior turns out to be wrong or unconfirmed, and it takes a live check or a
pasted SQL result to actually resolve. When picking up work here:

- Prefer reading the actual current code over trusting this file's specifics.
- If a fix changes what a report computes, confirm against real data (a SQL query
  result, a live page check) before calling it fixed — passing typecheck/lint/tests/
  build only proves the code compiles, not that the output is right.
- If you build a diagnostic route to verify an unfamiliar API field, follow the
  existing pattern (CRON_SECRET-gated, not in `vercel.json`, comment stating it's
  read-only and should be deleted once confirmed) so it doesn't get mistaken for
  permanent infrastructure later.
