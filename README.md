# Local Visibility Platform

Internal agency tool for geo-grid GBP rank tracking and multi-client review dashboards.
Built per the RFD in `docs/RFD.md` (or the working description shared in `claude/local-visibility-platform-*`).

## Stack

- Next.js 15 (App Router) + React 19
- TypeScript, Tailwind, custom shadcn-style UI primitives
- Drizzle ORM on Postgres (Supabase)
- Supabase Auth (`@supabase/ssr`) for internal-user sessions
- Leaflet + OpenStreetMap for heat maps
- DataForSEO Google Maps SERP API (async task_post + webhook postback)
- Google Places API for location onboarding
- Google Business Profile API for review ingestion (OAuth per location)
- Vercel cron for review polling and daily metrics rollups

## Prerequisites

| Need | Where it's used |
| --- | --- |
| Postgres database (Supabase) | `DATABASE_URL` |
| Supabase project | Auth + RLS |
| Google Cloud project with Places API enabled | Geocoding |
| Google Business Profile API access (OAuth client) | Review polling |
| DataForSEO account | Scan dispatch |
| Resend (optional) | Email alerts |
| Slack incoming webhook (optional) | Low-rated review alerts |

Copy `.env.example` to `.env.local` and fill in.

## Local development

```bash
npm install
npm run db:generate          # generate migrations from schema
npm run db:push              # push to your Postgres (or run db:migrate)
npm run dev                  # http://localhost:3000

npm test                     # vitest unit tests (grid, metrics, dataforseo)
npm run typecheck
npm run build
```

Seed a test client + location:

```bash
DATABASE_URL=... npx tsx src/lib/db/seed.ts
```

## v1 build status (per RFD §8)

| Step | Status | Notes |
| --- | --- | --- |
| 1. Schema + migrations | done | `src/lib/db/schema.ts`, migration `0000_init.sql`. All v1 tables, plus `reply_status` for v2 forward-compat. |
| 2. Location onboarding (Places only) | done | `POST /api/clients`, `POST /api/locations`, `GET /api/places/search`. UI form pending. |
| 3. Grid generation function | done | `src/lib/grid.ts` + 8 unit tests covering Minneapolis, Miami, equator. |
| 4. Scan dispatch + ingestion | done | `POST /api/scans/dispatch` and `POST /api/scans/postback` (HMAC-style token check). Concurrency-limited dispatch in chunks of 100, max 10 in flight. |
| 5. Heat map UI | done | `src/components/heat-map.tsx` rendered through dynamic import (`heat-map-client.tsx`) to avoid SSR. ARP / SoLV / Coverage on the location detail page. |
| 6. GBP OAuth flow | scaffold | `/api/oauth/google/start` and `/api/oauth/google/callback` exchange code, encrypt refresh token, attach to location. Quota request and verified app config required before live use. |
| 7. Review backfill | scaffold | `pollReviewsForLocation()` paginates GBP `accounts/.../locations/.../reviews`. Same code path used for backfill on first connect. |
| 8. Scheduled review polling | done | `vercel.json` cron `*/15 * * * *` → `/api/cron/poll-reviews`. Auth via `CRON_SECRET`. |
| 9. Daily metrics snapshot | done | `vercel.json` cron `5 6 * * *` → `/api/cron/daily-metrics`. Upserts `location_daily_metrics`. |
| 10. Multi-client dashboard | done | `/clients`, `/clients/[slug]`, `/clients/[slug]/locations/[locationId]`. |
| 11. Slack alerting | done | `postSlackAlert()` invoked from poll loop for new reviews ≤3★. |

### Forward-compatible (no migration needed for v2)

- Review reply: `reviews.reply_text`, `reviews.reply_status`, `reviews.replied_at` already in schema.
- Sentiment: drop a `sentiment_score numeric` on `reviews` later.
- Competitor entity tracking: `scan_points.competitors_json` is already populated per cell.

## Architecture notes

### Worker model
Per RFD §7, no separate worker process. A scan is a fan-out of N×K
DataForSEO `task_post` calls (chunked at 100, concurrency-limited at 10) all
issued from a single Vercel function in <60s, then results trickle back via
postback. Each postback handler is small (<10s). See
`src/lib/scans.ts` and `src/app/api/scans/postback/route.ts`.

### Postback authentication
`DATAFORSEO_POSTBACK_SECRET` is appended to the postback URL as `?token=...`
and verified with a constant-time comparison
(`src/lib/crypto.ts:timingSafeEqual`). Treat the secret as long-lived; rotate
by updating both the env var and any in-flight scan dispatch URLs (in flight
postbacks will 401 after rotation).

### OAuth credentials at rest
GBP refresh tokens are encrypted with `aes-256-gcm` using `ENCRYPTION_KEY`
(32 bytes, base64). `src/lib/crypto.ts`. Generate one with:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

### ARP strategy
`computeScanMetrics()` defaults to `ignore_null` (the RFD's "more honest" path
isn't the default). Switch to `treat_null_as_21` or `treat_null_as_100` per
client preference; UI knob is open work.

## Open work (not blocking initial preview)

- UI for client/location onboarding (the API routes exist; building the form
  is straightforward).
- Per-keyword filtering + comparison view on the heat map.
- Scan history "delta arrow" against previous month (data is captured in
  `location_daily_metrics` and per-scan `scan_points`; just needs the SQL).
- Supabase RLS policies (RFD §10.4 deferred to "all internal users see
  everything" until told otherwise).
- DataForSEO rate-limit handling beyond 10-concurrent chunking.
- Tests for `scans.ts`, `reviews.ts`, the API routes (the pure-logic core has
  24 vitest tests already).

## Deployment

1. Provision Supabase project, run migrations: `DATABASE_URL=... npm run db:migrate`.
2. Set every var in `.env.example` on Vercel.
3. Deploy. Vercel cron config in `vercel.json` will pick up automatically.
4. Set `DATAFORSEO_POSTBACK_URL` to `https://<your-vercel-domain>/api/scans/postback`.
5. Configure the Google OAuth client redirect URI to
   `https://<your-vercel-domain>/api/oauth/google/callback`.
