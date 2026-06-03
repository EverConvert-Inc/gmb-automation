# **Local Visibility Platform**

Knowledge Transfer Guide — v2

*Prepared by Travis Godec, Director of SEO*

# **Overview**

The Local Visibility Platform (internal name: local-visibility-platform) is the in-house web application EverConvert uses to track every client's local visibility in one place. It now covers three pillars:

  - **Local SEO** — local pack rankings via DataForSEO geo-grid scans of Google Maps, organic SERP rankings via DataForSEO organic SERP scans, and Google Business Profile reviews via the official GBP API.
  - **PPC reporting** — Google Ads campaign performance (clicks, impressions, conversions, phone calls, cost) pulled per linked customer, plus CallRail signed-case attribution mapped to each client. A daily PDF of the full report is emailed automatically.
  - **Operations dashboards** — one client dashboard per location showing a live heat map of rank, a triage view of reviews including owner replies, and a tracked-keyword ranking table. A `/ppc` dashboard with KPIs, a phone-calls-by-day chart, and a per-client campaign breakdown.

<https://gmb-automation.vercel.app/>

Username: accounts@everconvert.com
Password: stored in the team password manager (1Password / Bitwarden) — do not paste credentials into this file or into git.

The app is a Next.js application deployed on Vercel, backed by a Supabase Postgres database. Everything is billed to accounts@everconvert.com. That mailbox is the single recovery point for nearly every service in this stack and should be treated as critical.

# **Monthly Cost Summary**

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| **Service** | **Units** | **Unit Cost** | **Monthly Total** |
| Vercel (hosting + cron) | 1 project, Pro | $20 | ~$20 |
| Supabase (Postgres + Auth) | 1 project | Free or $25 Pro | $0 to $25 |
| DataForSEO | PAYG, auto-refill | $50 per refill | ~$5 |
| Google Places API | Usage-based | Free tier covers | ~$0 |
| Google Business Profile API | Usage-based | Free | $0 |
| Google Ads API | Usage-based | Free | $0 |
| Resend (PPC report email) | 1 send/day | Free tier covers (3,000/mo) | $0 |
| CallRail | Already part of agency stack | n/a | $0 incremental |
| **ESTIMATED TOTAL** |   |   | **~$25** |

These are estimates. Confirm the actual Vercel and Supabase tiers in their respective billing dashboards. DataForSEO scales with the number of clients, keywords, and the frequency at which scans are run. Resend's free tier covers 3,000 emails per month and 100 per day, well above our one-per-day distribution send.

# **1. Code Repository (GitHub)**

The app's entire source lives in one GitHub repository under the EverConvert-Inc organization. Vercel is wired to this repo and auto-deploys on push.

|  |  |
| :-: | :-: |
| **Repository** | https://github.com/EverConvert-Inc/gmb-automation |
| **Owner** | EverConvert-Inc (GitHub Organization) |
| **Production Branch** | Check Vercel project settings under Git, Production Branch |
| **Tech Stack** | Next.js 15 (App Router), React 19, TypeScript, Tailwind, Drizzle ORM, Leaflet, @react-pdf/renderer, Resend |

### **Folder Map**

  - **src/app/** Next.js routes (pages and API endpoints)
  - **src/app/api/** All backend endpoints. Includes the six Vercel-cron entry points under src/app/api/cron/
  - **src/app/ppc/** The PPC report dashboard and PPC client management screens
  - **src/components/** React components (heat map, reviews triage, search rankings card, hero snapshot, PPC report table, PPC date filter, recipients card, and so on)
  - **src/lib/** Server-side logic: db/ (Drizzle schema and migrations), dataforseo.ts, gbp.ts, scans.ts, reviews.ts, google-ads.ts, callrail.ts, ppc-sync.ts, ppc-pdf.tsx, ppc-email.ts, and so on
  - **vercel.json** Vercel cron schedule. See Scheduled Jobs section.
  - **src/lib/db/migrations/** Database migrations. Generated with npm run db:generate, applied with npm run db:migrate. Also wired into the Vercel build step.
  - **docs/google-cloud-setup.md** The original walkthrough for setting up the Google Cloud project (Places and OAuth client).

# **2. Application Hosting (Vercel)**

Vercel hosts the Next.js app and runs the scheduled cron jobs. The Vercel project is connected to the GitHub repository above and rebuilds and redeploys automatically every time the production branch is updated.

|  |  |
| :-: | :-: |
| **Portal** | https://vercel.com/ |
| **Login Method** | SSO via accounts@everconvert.com |
| **Project Name** | Verify in Vercel dashboard. Connects to EverConvert-Inc/gmb-automation |
| **Cost** | ~$20 per month (Pro tier, verify in billing) |

### **What Vercel Handles Automatically**

  - Production deploys on push to the production branch.
  - Preview deploys on every other branch (useful for review).
  - The seven cron jobs declared in vercel.json (poll-reviews, daily-metrics, serp-scan, ppc-google-ads-sync, ppc-callrail-sync, ppc-email-report, dataforseo-spend-snapshot).
  - Serverless function execution for every API route under /api/\*.

Environment variables for every external service are configured under Vercel, Project, Settings, Environment Variables. See section 9 for the full list.

# **3. Database and Authentication (Supabase)**

Supabase provides both the Postgres database and the authentication layer for internal users (magic-link login). The app uses the standard Supabase SSR helpers (@supabase/ssr) so sessions live in HTTP-only cookies set by Next.js.

|  |  |
| :-: | :-: |
| **Portal** | https://supabase.com/dashboard |
| **Username** | accounts@everconvert.com |
| **Password** | See the team password manager. |
| **Cost** | Free tier, or $25 per month Pro (verify in Supabase billing) |

### **Important Values to Grab from Supabase Project Settings**

  - **DATABASE\_URL** the connection string (pooled). Used by the app at runtime.
  - **NEXT\_PUBLIC\_SUPABASE\_URL** the project URL. Used by the browser client.
  - **NEXT\_PUBLIC\_SUPABASE\_ANON\_KEY** the public anon key used by the browser client.

### **Schema**

The database schema is defined in code at src/lib/db/schema.ts (Drizzle ORM). The current set of tables, grouped by feature:

**Local SEO and reviews**

  - **clients** agency clients (for example, "The Weinstein Firm").
  - **locations** each physical business location under a client. Holds GBP linkage and the public Google Places metadata snapshot.
  - **oauth\_credentials** encrypted refresh tokens (AES-256-GCM, see src/lib/crypto.ts). Used by both GBP and Google Ads.
  - **keywords, grid\_configs** rank-grid scan inputs.
  - **scans, scan\_points** one row per scan, one row per (keyword by grid cell). scan\_points stores the cell's rank, lat/lng, and the top competitors found at that point.
  - **reviews** one row per GBP review pulled. Includes owner reply text and reply timestamp.
  - **location\_performance\_daily, location\_daily\_metrics** daily rollups used by sparklines and trend deltas.
  - **tracked\_keywords, serp\_rankings, serp\_scan\_jobs** organic SERP tracking (separate from the rank-grid heat map).

**PPC tracking**

  - **ppc\_clients** one row per PPC client. Holds the Google Ads customer ID, the CallRail company ID, the signed-case tag (default "Signed"), per-client name filters for signed-case attribution (default `['PPC', 'Ads', 'GMB']`), and last-sync timestamps. A PPC client is its own thing — not the same as the agency `clients` table above.
  - **ppc\_campaigns** dimension table. One row per Google Ads campaign per PPC client. Stores the Google Ads campaign id, name, and last-seen status.
  - **ppc\_ads\_daily** fact table. One row per (campaign × date) of Google Ads metrics: clicks, impressions, conversions, phone calls, cost in micros.
  - **ppc\_callrail\_daily** fact table. One row per (PPC client × date) of CallRail rollups: total calls and signed cases.
  - **ppc\_sync\_jobs** audit log for sync runs. Tracks kind (google\_ads / callrail), status, timing, error message, and triggered-by (scheduled / manual).
  - **ppc\_report\_recipients** the distribution list for the daily PDF email. Edited from the /settings page in the app.

**Operations / observability**

  - **dataforseo\_spend\_snapshots** one row per UTC day, storing DataForSEO's lifetime spend (money.total − money.balance from /v3/appendix/user_data). Written daily by the dataforseo-spend-snapshot cron. Powers the "SEO API spend" indicator in the sidebar — MTD = current lifetime − earliest snapshot in the current month.

### **Migrations**

Stored at src/lib/db/migrations/\*.sql. The Vercel build runs drizzle-kit migrate automatically before next build, so deploying new schema changes is commit and push.

# **4. DataForSEO (Rank Tracking)**

DataForSEO is the heaviest external dependency. The app uses it for two different jobs:

  - **Geo-grid rank scans (the heat map).** Calls Google Maps SERP. Each scan fans out into N by K tasks (N grid points by K keywords) submitted via the async task\_post endpoint. Results come back to our /api/scans/postback webhook.
  - **Organic SERP scans (the Search rankings card).** Calls the Google organic SERP live/regular endpoint, geo-targeted to a per-keyword city.

### **Account Access**

|  |  |
| :-: | :-: |
| **Portal** | https://app.dataforseo.com/ |
| **Login Method** | SSO via accounts@everconvert.com |
| **Billing Model** | Pay-as-you-go. $50 initial purchase. Auto-refills $50 when balance hits $5 |
| **Auth Credentials** | Stored as DATAFORSEO\_LOGIN and DATAFORSEO\_PASSWORD in Vercel env vars (Basic Auth header on every API call) |
| **Postback Secret** | Long-lived secret stored as DATAFORSEO\_POSTBACK\_SECRET. Appended to the callback URL as ?token=... and verified with a constant-time compare in /api/scans/postback |
| **Postback URL** | DATAFORSEO\_POSTBACK\_URL = https://\<your-vercel-domain\>/api/scans/postback |

### **Where the Code Lives**

  - **src/lib/dataforseo.ts** thin client. authHeader(), the rank-grid postTasks() dispatcher, the organic-SERP pullOrganicSerp() function, the METRO\_LOCATIONS city to DataForSEO location-code map.
  - **src/lib/scans.ts** createAndDispatchScan() orchestrates the fan-out for the rank grid.
  - **src/lib/serp-scan.ts** orchestrates the weekly organic-SERP run for tracked keywords.
  - **src/app/api/scans/postback/route.ts** receives one webhook per completed grid task and updates the corresponding scan\_points row.

### **Cost Watch**

The biggest driver is rank-grid scan volume. An 11 by 11 grid is 121 points per keyword per scan. Scans are user-triggered or weekly. If a balance refill ever fires twice in a month it's usually a runaway scan trigger or a stuck retry, not real usage growth. Check the scans table for an unusual count of recent rows.

# **5. Google APIs**

The app uses three distinct Google APIs from one Google Cloud project. The operator setup walkthrough for Places and GBP lives in the repo at docs/google-cloud-setup.md.

## **5a. Google Cloud Project**

|  |  |
| :-: | :-: |
| **Console** | https://console.cloud.google.com/ |
| **Login Method** | SSO via clientmaps@everconvert.com (same Google account that manages client GBPs) |
| **APIs Enabled** | Places API (New), Business Profile API, Google Ads API, Geocoding API (used indirectly via Places) |
| **OAuth Consent Screens** | External user type. Two OAuth clients live here — one for GBP (scope https://www.googleapis.com/auth/business.manage) and one for Google Ads (scope https://www.googleapis.com/auth/adwords) |

## **5b. Places API (Geocoding New Locations and Keyword Cities)**

|  |  |
| :-: | :-: |
| **API Key** | Stored as GOOGLE\_PLACES\_API\_KEY in Vercel env vars |
| **Used By** | src/lib/places.ts. Called from the Add Location form and from the keyword-management page when a tracked-keyword city needs lat/lng |
| **Cost** | Negligible. Google's $200 per month free credit covers all typical usage |

## **5c. Business Profile API (Review Pull)**

This one requires OAuth per location. When a user clicks Connect Google Business Profile on a location, we redirect them through Google's OAuth flow. The returned refresh token is encrypted with AES-256-GCM (ENCRYPTION\_KEY env var) and stored in oauth\_credentials. From then on the polling job uses that refresh token to call the GBP API on behalf of the connected agency Google account.

|  |  |
| :-: | :-: |
| **OAuth Client ID** | GOOGLE\_OAUTH\_CLIENT\_ID env var |
| **OAuth Client Secret** | GOOGLE\_OAUTH\_CLIENT\_SECRET env var |
| **Redirect URI** | GOOGLE\_OAUTH\_REDIRECT\_URI env var. Must equal https://\<your-vercel-domain\>/api/oauth/google/callback |
| **Scope Requested** | https://www.googleapis.com/auth/business.manage |
| **Cost** | Free (quota-controlled by Google) |

**Important.** The Google account that does the OAuth connect on a location must already be a manager on that location's Google Business Profile. If it's not, the OAuth succeeds but our discovery call can't find a matching listing (the UI shows the Connected, but no matching listing amber banner) and reviews won't sync.

## **5d. Google Ads API (PPC Metrics Pull)**

This one requires OAuth per PPC client. When an operator links Google Ads on a PPC client's detail page, we redirect them through Google's OAuth flow. The returned refresh token is encrypted (same AES-256-GCM scheme, reusing ENCRYPTION\_KEY) and stored in oauth\_credentials. We then call listAccessibleCustomers, populate the dropdown of Google Ads customer IDs the connected account can see, and the operator picks the one to bind to this PPC client.

Once linked, the daily cron pulls per-campaign metrics for yesterday via a GAQL query: `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.{clicks, impressions, conversions, cost_micros, phone_calls} FROM campaign WHERE segments.date BETWEEN <from> AND <to>`. Brand-new campaigns inside an already-linked customer are auto-discovered (a new row is inserted into ppc\_campaigns the first time we see a campaign id we don't have).

|  |  |
| :-: | :-: |
| **OAuth Client ID** | GOOGLE\_ADS\_OAUTH\_CLIENT\_ID env var (separate OAuth 2.0 client from the GBP one) |
| **OAuth Client Secret** | GOOGLE\_ADS\_OAUTH\_CLIENT\_SECRET env var |
| **Redirect URI** | GOOGLE\_ADS\_OAUTH\_REDIRECT\_URI env var. Must equal https://\<your-vercel-domain\>/api/oauth/google-ads/callback |
| **Scope Requested** | https://www.googleapis.com/auth/adwords |
| **Developer Token** | GOOGLE\_ADS\_DEVELOPER\_TOKEN env var. Issued by Google's Ads API Center, attached to the agency's manager account. Required on every API call. |
| **Login Customer ID** | GOOGLE\_ADS\_LOGIN\_CUSTOMER\_ID env var. Manager (MCC) customer id. Sent on every API call so Google knows which manager account is brokering access to the child accounts. |
| **Cost** | Free (quota-controlled by Google) |

**Important.** The connected Google account must have access to every Google Ads customer ID the operator wants to bind. If a customer ID is missing from the dropdown, it's almost always a missing-access issue at the Google Ads side, not a bug in the LVP.

# **6. CallRail (Signed-Case Attribution)**

CallRail is where phone-call leads from PPC campaigns land. We pull each PPC client's CallRail company and roll up two numbers per day: total calls and signed cases. The "signed case" count comes from a per-client rule — calls tagged with the configured signed-case tag (default "Signed") whose tracking-number name contains one of the configured name filters (default `PPC`, `Ads`, `GMB`).

|  |  |
| :-: | :-: |
| **Portal** | https://app.callrail.com/ |
| **Login Method** | Agency CallRail account credentials |
| **Per-client Linkage** | Each PPC client is bound to a single CallRail company. The company ID is set on the PPC client edit page after the operator clicks "Link CallRail" and picks from a dropdown of companies our API key can see. |
| **Per-client Tuning** | signedCaseTag and signedCaseNameFilters columns on ppc\_clients. Editable from the client's detail page when initial defaults need adjusting. |

### **Where the Code Lives**

  - **src/lib/callrail.ts** thin client. Authenticates against the CallRail v3 API, lists companies, pulls calls for a date range, groups by day and applies the signed-case rule.
  - **src/lib/ppc-sync.ts** syncCallrailForClient() orchestrates the per-client daily pull and writes to ppc\_callrail\_daily.

# **7. Resend (PPC Report Email)**

Resend handles the daily PDF email. We render a per-period PPC report PDF in-process with @react-pdf/renderer and ship it as an email attachment.

|  |  |
| :-: | :-: |
| **Portal** | https://resend.com/ |
| **Login Method** | accounts@everconvert.com |
| **Verified Domain** | everconvert.com (DNS verified via SPF/DKIM/DMARC records). Subdomains require separate verification. |
| **Cost** | Free tier covers our volume (3,000/month, 100/day; we send roughly 1/day) |
| **Sender Address** | PPC\_REPORT\_FROM\_EMAIL env var. Must be on the verified domain. Currently `ppc-reports@everconvert.com`. |
| **API Key** | RESEND\_API\_KEY env var |
| **Recipients** | Stored in the ppc\_report\_recipients table. Managed from the /settings page in the app — no redeploy needed to add or remove an address. |

### **Where the Code Lives**

  - **src/lib/ppc-pdf.tsx** the PDF document component. Uses @react-pdf/renderer to render a US Letter document with a header, KPI strip, and one section per PPC client showing client totals and a campaign breakdown.
  - **src/lib/ppc-email.ts** sendDailyPpcEmail() orchestrates pulling the report, rendering the PDF, building an HTML+text email body, and dispatching to all configured recipients via Resend.
  - **src/app/api/cron/ppc-email-report/route.ts** the daily cron entry point. Defaults to month-to-date. Also serves `?dry=1` for an inline PDF preview during development.
  - **src/app/api/ppc/send-report/route.ts** the operator-triggered send. Backs the "Email this report" button on the /ppc page; sends whatever date range the page filter currently has selected.

# **8. Operational Email Account**

accounts@everconvert.com is the single login on file for the platform's paid services: Vercel, Supabase, DataForSEO, Resend. clientmaps@everconvert.com owns Google Cloud and the Google Business Profile manager account. Treat both as critical. If either password rotates without warning, the dependent services lose SSO access or fail at next OAuth refresh.

# **9. Environment Variables**

Every external dependency is configured through environment variables on Vercel. Below is the authoritative list. Names follow the references in src/.

### **Core Platform**

|  |  |  |
| :-: | :-: | :-: |
| **Variable** | **Purpose** | **Source** |
| DATABASE\_URL | Postgres connection string (pooled). Used by Drizzle at runtime. | Supabase, Connect, Connection Pooling |
| NEXT\_PUBLIC\_SUPABASE\_URL | Supabase project URL (public). | Supabase, Project Settings |
| NEXT\_PUBLIC\_SUPABASE\_ANON\_KEY | Supabase anon key (public). | Supabase, Project Settings, API |
| NEXT\_PUBLIC\_APP\_URL | Public base URL for the deployed app (used in email links). Optional — defaults to https://gmb-automation.vercel.app if unset. | Set per-deploy |
| ENCRYPTION\_KEY | 32-byte base64 key used to AES-256-GCM-encrypt OAuth refresh tokens at rest (GBP and Google Ads). Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | Generated once, kept in Vercel |
| CRON\_SECRET | Bearer token Vercel cron passes when calling our cron endpoints. Verified server-side to block public access. | Generated once, kept in Vercel |
| SLACK\_WEBHOOK\_URL | (Optional) Incoming webhook posted to when a new low-rated review (3 stars or below) arrives. | Slack workspace, Apps, Incoming Webhooks |

### **DataForSEO**

|  |  |  |
| :-: | :-: | :-: |
| **Variable** | **Purpose** | **Source** |
| DATAFORSEO\_LOGIN | Basic-auth username for DataForSEO API. | DataForSEO dashboard, API Access |
| DATAFORSEO\_PASSWORD | Basic-auth password for DataForSEO API. | DataForSEO dashboard, API Access |
| DATAFORSEO\_POSTBACK\_URL | Where DataForSEO posts task results: https://\<domain\>/api/scans/postback | Set per-deploy |
| DATAFORSEO\_POSTBACK\_SECRET | Token appended to postback URL. Verified server-side. | Generated once, kept in Vercel |

### **Google Places + GBP**

|  |  |  |
| :-: | :-: | :-: |
| **Variable** | **Purpose** | **Source** |
| GOOGLE\_PLACES\_API\_KEY | Server-side key for Google Places API calls. | Google Cloud Console, Credentials |
| GOOGLE\_OAUTH\_CLIENT\_ID | OAuth client ID for GBP authentication. | Google Cloud Console, Credentials, OAuth 2.0 Client |
| GOOGLE\_OAUTH\_CLIENT\_SECRET | OAuth client secret for GBP authentication. | Google Cloud Console, Credentials |
| GOOGLE\_OAUTH\_REDIRECT\_URI | Where Google sends users after consent: https://\<domain\>/api/oauth/google/callback. Must match the Google Cloud client config exactly. | Set per-deploy |

### **Google Ads (PPC)**

|  |  |  |
| :-: | :-: | :-: |
| **Variable** | **Purpose** | **Source** |
| GOOGLE\_ADS\_OAUTH\_CLIENT\_ID | OAuth client ID for the Google Ads OAuth 2.0 client. Distinct from the GBP one. | Google Cloud Console, Credentials, OAuth 2.0 Client |
| GOOGLE\_ADS\_OAUTH\_CLIENT\_SECRET | OAuth client secret for the Google Ads OAuth client. | Google Cloud Console, Credentials |
| GOOGLE\_ADS\_OAUTH\_REDIRECT\_URI | Where Google sends users after consent: https://\<domain\>/api/oauth/google-ads/callback. Must match the Google Cloud client config exactly. | Set per-deploy |
| GOOGLE\_ADS\_DEVELOPER\_TOKEN | Issued by Google's Ads API Center against the agency's manager account. Required on every Google Ads API call. | Google Ads → Tools → API Center |
| GOOGLE\_ADS\_LOGIN\_CUSTOMER\_ID | Manager (MCC) customer ID. Sent on every API call so Google knows which manager account is brokering access. | Google Ads UI, customer ID at the top of the page |

### **CallRail (PPC)**

|  |  |  |
| :-: | :-: | :-: |
| **Variable** | **Purpose** | **Source** |
| CALLRAIL\_API\_KEY | API key for the agency CallRail account. Used for all per-client company / call pulls. | CallRail dashboard, Integrations, API Keys |
| CALLRAIL\_ACCOUNT\_ID | Numeric account ID for the agency CallRail account. | CallRail dashboard, Settings |
| CALLRAIL\_API\_BASE | (Optional) Base URL for the CallRail API. Defaults to https://api.callrail.com. Only override for sandbox testing. | n/a |

### **Resend (PPC Email)**

|  |  |  |
| :-: | :-: | :-: |
| **Variable** | **Purpose** | **Source** |
| RESEND\_API\_KEY | API key (starts with re\_…) used to dispatch the daily PPC PDF. | Resend dashboard, API Keys |
| PPC\_REPORT\_FROM\_EMAIL | The From: address on the daily email. Must be on a Resend-verified domain. Currently ppc-reports@everconvert.com. | Set per-deploy |

# **10. Scheduled Jobs (Vercel Cron)**

Vercel runs six scheduled jobs against the deployed app. They're declared in vercel.json and live as plain API routes under src/app/api/cron/\*. Each one verifies the incoming Authorization: Bearer $CRON\_SECRET header before doing anything.

|  |  |  |
| :-: | :-: | :-: |
| **Endpoint** | **Schedule (UTC)** | **What It Does** |
| /api/cron/poll-reviews | \*/15 \* \* \* \* | Every 15 minutes. For every location due for polling, pulls fresh reviews from GBP, upserts into the reviews table (including owner reply text), fires a Slack alert on any new low-rated review. |
| /api/cron/daily-metrics | 5 6 \* \* \* | 06:05 UTC daily. Computes per-location daily rollups (average rating, count, last-30, last-90, days since last) and upserts into location\_daily\_metrics. Powers the sparklines and trend deltas. |
| /api/cron/ppc-google-ads-sync | 30 9 \* \* \* | 09:30 UTC daily (5:30 AM EDT / 4:30 AM EST). For every active PPC client with Google Ads linked, pulls yesterday's per-campaign metrics via GAQL and upserts into ppc\_campaigns + ppc\_ads\_daily. New campaigns are auto-discovered. |
| /api/cron/ppc-callrail-sync | 40 9 \* \* \* | 09:40 UTC daily (5:40 AM EDT / 4:40 AM EST). For every active PPC client with CallRail linked, pulls yesterday's calls, applies the per-client signed-case rule (tag + tracking-number-name filter), and upserts into ppc\_callrail\_daily. |
| /api/cron/ppc-email-report | 0 10 \* \* \* | 10:00 UTC daily (6:00 AM EDT / 5:00 AM EST). Pulls the month-to-date PPC report, renders the PDF, dispatches via Resend to every address in ppc\_report\_recipients. Skips (no send) when no PPC client has data for the period. **Note:** locked to EDT — during EST (winter) the report lands at 5:00 AM ET. Shift the UTC times by one hour at the DST changeovers if you want a stable 6:00 AM ET arrival year-round. |
| /api/cron/dataforseo-spend-snapshot | 5 0 \* \* \* | 00:05 UTC daily. Calls /v3/appendix/user_data and captures today's lifetime DataForSEO spend into dataforseo\_spend\_snapshots (idempotent: only inserts if today's row is missing). The first snapshot of each month becomes that month's MTD anchor, displayed in the "SEO API spend" indicator in the sidebar. Guarantees an accurate anchor even when nobody opens the LVP on the 1st of the month. |
| /api/cron/serp-scan | 0 9 \* \* 4 | Thursdays 09:00 UTC. For every active tracked keyword, runs a DataForSEO organic SERP scan geo-targeted to its city, parses our ranking from the result, writes to serp\_rankings. Powers the Search rankings card. |

# **11. Day-to-Day Operations**

This is the "how do I" reference for the most common operator tasks.

### **Adding a New Client**

1.  Click New Client on /clients. Fill in client name. The form auto-creates a URL-safe slug.
2.  On the client page, click Add Location. Search Google Places by business name or address. Pick the matching place from results.
3.  Add at least one keyword (for example, "car accident lawyer"), pick a grid size (11 by 11 is the default), and a radius in miles.
4.  Leave the Connect Google Business Profile after creating checkbox on. After submit the user goes straight to the Google OAuth flow. Coming back lands them on the new location.
5.  Click Run New Scan in the heat-map card to populate the first grid.

### **Connecting Google Business Profile to an Existing Location**

1.  From the location's hero card, click Connect Google Business Profile.
2.  Authorize with a Google account that is a manager on this specific GBP listing. The agency Google account is the right one.
3.  The callback automatically triggers a first review sync. The hero card flips to a green GBP Connected badge.
4.  If you see Connected, but no matching listing: the Google account isn't a manager on this listing. Sign in with the right account and retry.

### **Running a Rank-Grid Scan Manually**

1.  On the location's heat-map card, expand Scan Management.
2.  Pick the grid config (size and radius) and which keywords to run. Click Run New Scan.
3.  The map starts filling in cell-by-cell over 30 to 90 seconds as DataForSEO posts results back. No reload needed.

### **Adding or Editing Tracked Organic-SERP Keywords**

1.  From the client page, click Manage Keywords.
2.  Each keyword needs: the keyword text, the target URL on the client's site, and the city to search from.
3.  The weekly cron picks them up the next Thursday. To get an instant result, click Scan Now on the keyword management page.

### **Syncing Reviews on Demand**

The 15-minute cron pulls new reviews automatically. To force a full re-sync now (useful if a location was just connected, or if owner replies aren't showing up), click Sync Now on the Reviews card. The button does a full pull (ignores the last-polled timestamp) so it backfills any replies that GBP didn't mark as updated.

### **Adding a New PPC Client**

1.  From /ppc, click Manage PPC Clients, then Add PPC Client.
2.  Enter the client name. The form auto-creates a URL-safe slug. Submit.
3.  On the PPC client's detail page:
    - **Link Google Ads.** Click Connect Google Ads. Authorize with a Google account that has access to the client's Google Ads customer. Back on the detail page, pick the customer ID from the dropdown and click Attach.
    - **Link CallRail.** Click Link CallRail. Pick the matching CallRail company from the dropdown.
    - **Tune signed-case attribution (optional).** Default rule is tag = "Signed" AND tracker name contains one of PPC / Ads / GMB. Adjust if the client's CallRail tagging convention differs.
4.  Click Sync Now to pull the trailing 30 days for both Google Ads and CallRail. Data appears in /ppc immediately.

### **Managing Daily PPC Email Recipients**

1.  Go to /settings.
2.  Under PPC report recipients, type an email and click Add. To remove, click the trash icon on the row.
3.  Changes apply to the next scheduled send (07:00 UTC) — no redeploy.

### **Emailing the PPC Report On Demand**

1.  On /ppc, set the date filter to whatever window you want covered.
2.  Click Email This Report next to Manage PPC Clients. The button confirms with an inline status (sent / skipped / error).
3.  Useful for testing Resend configuration without waiting for the morning cron.

### **Triggering a PPC Sync On Demand**

The daily cron pulls yesterday only. For a same-day pull (or to backfill after a misconfiguration), open the PPC client's detail page and click Sync Now — that pulls the trailing 30 days for both Google Ads and CallRail.

# **How It All Connects**

Here's the basic flow so the next person understands why each piece exists.

1.  Vercel serves the Next.js app on a public URL. Internal users log in via Supabase Auth (magic-link email).
2.  Supabase Postgres stores every persistent record: clients, locations, keywords, scans, scan points, reviews, OAuth tokens (encrypted), tracked keywords, SERP rankings, daily rollups, PPC clients, PPC campaigns and daily metrics, PPC sync jobs, and PPC report recipients.
3.  Google Places API backs the Add Location search box and is also called when an operator types a city for a tracked-keyword so we can store the city's lat/lng. That lat/lng is what we hand DataForSEO to geo-target organic SERP calls.
4.  Google Business Profile API backs review pulling. Each connected location has its own OAuth refresh token (encrypted in oauth\_credentials). The 15-minute cron walks every location due for poll and pulls fresh reviews and owner replies.
5.  Google Ads API backs PPC metric pulling. Each linked PPC client has its own OAuth refresh token (also encrypted in oauth\_credentials, using the same key) plus a bound Google Ads customer ID. The daily 06:30 UTC cron pulls yesterday's per-campaign metrics for every active PPC client.
6.  CallRail API backs signed-case attribution. The daily 06:40 UTC cron pulls yesterday's calls for each PPC client's linked CallRail company, applies the per-client signed-case rule, and rolls up to a single (client × date) row.
7.  DataForSEO handles all rank tracking. Heat-map scans fan out to task\_post with our postback URL. DataForSEO calls our webhook back with per-cell results, which we save into scan\_points. The dashboard polls our own DB every 5 seconds while a scan is running so the map updates live. Organic SERP scans run synchronously every Thursday (and on-demand from the keyword page), writing to serp\_rankings.
8.  Resend dispatches the daily PPC PDF email. The 07:00 UTC cron pulls the month-to-date PPC report from Postgres, renders the PDF in-process with @react-pdf/renderer, and emails it as an attachment to every address in ppc\_report\_recipients.
9.  Slack webhook (optional) fires when a freshly-pulled review is 3 stars or below, so the team can react quickly on low ratings.
10. Vercel cron is what keeps the pipeline alive when no one is using the dashboard: review polling, daily rollups, weekly SERP scans, daily PPC syncs, and the morning PPC email all run on Vercel's schedule with no human in the loop.

# **Recovery and Troubleshooting**

### **Reviews Stopped Syncing for a Location**

Check the location hero card. The sync status pill shows the last poll time and the last error. The most common cause is that the agency Google account lost manager access to that specific GBP listing. Re-grant access in business.google.com, then click Sync Now.

### **Heat-Map Scan Stuck on Running**

Check the scan\_points table. Pending cells with no postback usually mean DataForSEO returned a task that's still working through their queue. Wait 5 to 10 minutes. If a cell is permanently errored, click Rerun in scan history.

### **Postback Returns 401**

Happens after rotating DATAFORSEO\_POSTBACK\_SECRET. Any in-flight scan dispatched before the rotation will be stuck. Either let the orphan scan time out or re-dispatch.

### **Vercel Deploy Fails on drizzle-kit migrate**

Usually a schema collision because someone edited the DB by hand. Compare the migration files in src/lib/db/migrations/ to what's actually applied on Supabase (\_\_drizzle\_migrations table) and resolve.

### **DataForSEO Balance Hits Zero Unexpectedly**

Auto-refill should kick in at $5. If it's disabled, the next scan dispatch will fail with HTTP 401 (insufficient credit). Re-enable refill in DataForSEO billing.

### **ENCRYPTION\_KEY Ever Gets Rotated**

Every existing OAuth refresh token becomes unreadable (both GBP and Google Ads). Don't do this without a migration plan. Either re-encrypt all rows on rotation, or treat it as "every location must reconnect GBP and every PPC client must reconnect Google Ads."

### **PPC Email Stopped Sending**

Check the Vercel function logs for /api/cron/ppc-email-report. Common causes:
  - **No recipients configured.** The endpoint throws with a clear message. Add an address on /settings.
  - **From-address domain not verified.** Resend rejects the send with a validation\_error. Verify the domain in the Resend dashboard or switch PPC\_REPORT\_FROM\_EMAIL to an address on an already-verified domain.
  - **No PPC clients have data for the period.** The endpoint returns `{ sent: 0, reason: "no synced PPC clients for this period" }` and skips intentionally rather than blast empty PDFs.

### **PPC Numbers in the Email Don't Match /ppc**

The email uses month-to-date by default; the website's date filter may be set to a different window. Re-open /ppc with the same date range to compare. If they still differ, check whether the morning syncs (06:30 / 06:40 UTC) completed successfully in ppc\_sync\_jobs — the 07:00 UTC email may have fired with one sync still incomplete.

### **Google Ads Customer ID Missing from the Dropdown When Linking a PPC Client**

The connected Google account doesn't have access to that customer ID in Google Ads. Grant access in the Google Ads UI (Tools → Account Access), then click Refresh Customers on the PPC client's detail page.

### **CallRail "Signed" Count Doesn't Match the CallRail UI**

The LVP's signed-case count is *intersect*-style: a call only counts if it has the configured tag AND its tracking-number name contains one of the configured filter substrings. The CallRail UI usually shows tag-only counts. Adjust signedCaseTag or signedCaseNameFilters on the PPC client to match the agency's tagging convention.

# **Security and Handover Recommendations**

This document contains every credential and config note needed to operate the platform. A few suggestions for what to do with it once handover happens.

  - Store this document in a team password manager (1Password, Bitwarden, etc.). Don't leave it sitting in a Drive folder or email thread.
  - Rotate every password after handover: Supabase, DataForSEO API credentials, CallRail API key, Resend API key, Google Ads developer token, and any non-SSO logins. SSO-tied services (Vercel, Google Cloud) follow the Google account.
  - Rotate DATAFORSEO\_POSTBACK\_SECRET and CRON\_SECRET on a regular cadence. Both are bearer-style secrets and rotating them periodically is cheap insurance.
  - Do not rotate ENCRYPTION\_KEY without a migration plan. Doing so silently invalidates every connected OAuth refresh token — GBP review syncing and PPC Google Ads syncing both break quietly across every location and client.
  - Confirm GitHub access for whoever inherits this. They need at least write access to EverConvert-Inc/gmb-automation to deploy code changes.
  - If accounts@everconvert.com is ever decommissioned, update the recovery email on every service first or you will lose access to Vercel, Supabase, DataForSEO, Resend, and the GBP / Google Ads manager accounts.
  - Audit GBP manager access quarterly. Locations drop out of sync silently when the agency Google account loses manager rights on a client's listing.
  - Audit Google Ads access quarterly. PPC syncs fail silently if the connected account loses access to a customer ID — the ppc\_sync\_jobs table is the canonical source of recent run status.
  - Keep this document updated as workflows change.
