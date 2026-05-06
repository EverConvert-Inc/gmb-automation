# Google Cloud Console Setup — GBP + Places

This is the operator walkthrough for getting everything the Local Visibility
Platform needs out of one Google Cloud project. At the end you'll have five
values to relay back to Claude, plus two confirmations.

> Use the agency Google account that is (or will be made) a manager on the
> client GBP locations. Do not use a personal account. The same project
> covers Places (API key) and GBP (OAuth) — there is no reason to split them.

---

## 0. Before you start — collect these facts

Have these in front of you. Claude will ask for them at the end:

- The Google Cloud **project ID** (e.g. `everconvert-local-vis`).
- The agency **Google Workspace email** that will own OAuth consent and is a
  manager on client GBPs (e.g. `seo-ops@everconvert.com`).
- The **production domain** the app will be deployed to (likely a Vercel URL,
  e.g. `local-vis.everconvert.com` or `gmb-automation.vercel.app`). If you
  don't have one yet, use the placeholder Vercel preview domain.

---

## 1. Pick or create the project

1. Open <https://console.cloud.google.com/>.
2. Top bar → project picker → **New Project** if needed. Name it something
   like `EverConvert Local Visibility`.
3. Note the **Project ID** (auto-generated, looks like `evc-local-vis-12345`).
   You'll relay this so Claude can reference it in support tickets and quota
   change requests later.

---

## 2. Enable the four APIs

Console → **APIs & Services → Library**, then enable each of:

| API | Why we need it |
| --- | --- |
| **Places API (New)** | Geocoding + place_id resolution during location onboarding (RFD §6.1). |
| **My Business Account Management API** | `accounts.list` — discover which GBP accounts the agency manages. |
| **My Business Business Information API** | `accounts/{a}/locations` — discover individual locations under an account. |
| **Google My Business API** (v4) | The only path to review data (RFD §6.6). Often only available after quota approval; if you don't see it in the Library, that's normal — it shows up once your quota request is granted. |

Confirm each shows **API enabled** on its dashboard page. Take a screenshot or
note the four enabled APIs — Claude will ask you to confirm the list.

---

## 3. Configure the OAuth consent screen

Console → **APIs & Services → OAuth consent screen**.

1. **User type:** External (required for GBP scope unless your Workspace owns
   every client GBP, which it doesn't).
2. **App information:**
   - App name: `EverConvert Local Visibility` (or your chosen product name).
   - User support email: the agency Workspace email.
   - App logo: optional but recommended for the consent screen.
3. **App domain:**
   - Application home page: `https://<production-domain>`.
   - Privacy policy: `https://<production-domain>/privacy` (placeholder OK if
     not built yet — Google only checks it during verification, not in test
     mode).
   - Terms of service: same.
4. **Authorized domains:** add the production domain (Vercel root, e.g.
   `everconvert.com` or `vercel.app` if using a `*.vercel.app` URL).
5. **Developer contact:** the agency Workspace email.
6. **Scopes:** click **Add or remove scopes** and add exactly:

   ```
   https://www.googleapis.com/auth/business.manage
   ```

   No others. Places does not require an OAuth scope (API key only).
7. **Test users** (only if the app is still in "Testing" status): add the
   Google emails of every team member who will OAuth during dev. Up to 100.
8. **Publishing status:**
   - If Google has already verified the app + granted GBP quota → **In
     production**.
   - Otherwise → leave in **Testing** until verification clears.

Relay back: the **publishing status** (Testing vs In production) and the
**list of scopes** (should be just `business.manage`).

---

## 4. Create the OAuth 2.0 Web Client (for GBP)

Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**.

1. **Application type:** Web application.
2. **Name:** `Local Visibility Platform — Web`.
3. **Authorized JavaScript origins** (add both):
   - `http://localhost:3000`
   - `https://<production-domain>`
4. **Authorized redirect URIs** (add both — must match exactly, trailing
   slashes matter):
   - `http://localhost:3000/api/oauth/google/callback`
   - `https://<production-domain>/api/oauth/google/callback`
5. **Create**, then on the resulting modal copy:
   - **Client ID** — long string ending in `.apps.googleusercontent.com`.
   - **Client secret** — short opaque string.

> ⚠️ Treat the client secret like a password. Don't paste it into a public
> Slack channel or a non-private Claude chat. See "How to relay" below.

---

## 5. Create the Places API key

Console → **APIs & Services → Credentials → Create credentials → API key**.

1. After creation, click **Edit API key**.
2. **Name:** `Places — Local Visibility`.
3. **Application restrictions:**
   - Dev: **None** (or "IP addresses" with your office IP).
   - Production: **HTTP referrers** → `https://<production-domain>/*`.
4. **API restrictions:** **Restrict key** → select **Places API (New)** only.
   This prevents accidental misuse if the key ever leaks.
5. Save and copy the key value.

---

## 6. Confirm GBP quota and verification

Open a separate tab to the **Quotas & System Limits** page for each of the
three GBP APIs and confirm:

- The per-minute and per-day quota for `accounts.locations.reviews.list` is
  high enough for ~30 locations × 96 polls/day = ~2,900 calls/day. The
  default quota is far below this; you should see the bumped numbers from
  the approval letter.
- No "default quota" badge — bumped quotas show explicit numbers.

If the numbers look like defaults, the approval may not have propagated.
Forward the approval email so we can chase support.

For the OAuth app verification: on the OAuth consent screen page, the top
banner should say either **"In production"** (verified) or **"Testing"**
(unverified, capped at 100 users). Note which one you see.

---

## 7. How to relay back to Claude

Open a fresh chat with Claude (Chrome extension or otherwise) and paste the
block below, filling in your values. **Mask the client secret** — paste only
the first 6 characters in chat, and put the full secret directly into
`.env.local` yourself.

```
Project ID:              <project-id>
Agency Google account:   <ops@everconvert.com>
Production domain:       https://<production-domain>

GOOGLE_OAUTH_CLIENT_ID:     <client-id>.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET: <first 6 chars>...   (full value pasted into .env.local locally)
GOOGLE_OAUTH_REDIRECT_URI:  https://<production-domain>/api/oauth/google/callback
GOOGLE_PLACES_API_KEY:      <api-key>

OAuth publishing status:    Testing  | In production    (pick one)
APIs enabled (confirm all four):
  [x] Places API (New)
  [x] My Business Account Management API
  [x] My Business Business Information API
  [x] Google My Business API (v4)

Quota for accounts.locations.reviews.list:
  per-minute: <value>
  per-day:    <value>
```

That's everything Claude needs to (a) wire `.env.example` values, (b) decide
whether the per-location backfill is safe to run aggressively or must be
throttled, and (c) confirm the OAuth start URL will succeed.

---

## 8. After Claude has the values

Claude will:

1. Update `.env.example` if any new vars are required (none expected — the
   four above already exist).
2. Help you populate `.env.local` for local dev.
3. Help you mirror the same vars into Vercel (Settings → Environment
   Variables → Production + Preview).
4. Walk through the first end-to-end OAuth round-trip on `localhost:3000`
   to confirm token exchange + account discovery succeed.

If any step in §1–6 fails (API not in the Library, secret not shown,
authorized domain rejected, quota still at default), copy the error text
verbatim into chat — don't paraphrase. Google's error messages are usually
the fastest path to the fix.
