import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { clients, locations, oauthCredentials } from "@/lib/db/schema";
import { encryptString, hmacVerify } from "@/lib/crypto";
import { listAccounts, listLocations } from "@/lib/gbp";
import { pullPerformanceForLocation } from "@/lib/performance";
import { pollReviewsForLocation } from "@/lib/reviews";

export const runtime = "nodejs";
export const maxDuration = 60;

type StatePayload = { locationId: string; nonce: string; exp: number };

function verifyState(state: string): StatePayload | null {
  const dot = state.indexOf(".");
  if (dot < 0) return null;
  const payloadEncoded = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (!payloadEncoded || !sig) return null;
  if (!hmacVerify(payloadEncoded, sig)) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadEncoded, "base64url").toString("utf8"),
    ) as StatePayload;
  } catch {
    return null;
  }
  if (
    typeof payload.locationId !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp < Date.now()
  ) {
    return null;
  }
  return payload;
}

// Redirects back to the dashboard with the new location tab selected and a
// gbp_link outcome param that the dashboard renders as a banner.
function redirectWith(
  origin: URL,
  slug: string | null,
  locationId: string | null,
  params: Record<string, string>,
) {
  const dest = new URL(slug ? `/clients/${slug}` : "/clients", origin);
  if (slug && locationId) dest.searchParams.set("location", locationId);
  for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
  return NextResponse.redirect(dest);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return redirectWith(url, null, null, {
      gbp_link: "failed",
      reason: errorParam,
    });
  }
  if (!code || !state) {
    return NextResponse.json({ error: "missing code or state" }, { status: 400 });
  }
  const payload = verifyState(state);
  if (!payload) {
    return NextResponse.json({ error: "invalid or expired state" }, { status: 400 });
  }
  const { locationId } = payload;

  const clientIdEnv = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientIdEnv || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "OAuth env not set" }, { status: 500 });
  }

  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }
  const clientRow = await db.query.clients.findFirst({
    where: eq(clients.id, location.clientId),
  });
  const slug = clientRow?.slug ?? null;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientIdEnv,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    console.error("OAuth token exchange failed", { status: tokenRes.status, detail });
    return redirectWith(url, slug, locationId, {
      gbp_link: "failed",
      reason: "token_exchange_failed",
    });
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  if (!tokens.refresh_token) {
    return redirectWith(url, slug, locationId, {
      gbp_link: "failed",
      reason: "no_refresh_token",
    });
  }

  const userInfoRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  const userInfo = (await userInfoRes.json()) as { email?: string };
  const accountEmail = userInfo.email ?? "unknown";

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const accessTokenEncrypted = encryptString(tokens.access_token);
  const refreshTokenEncrypted = encryptString(tokens.refresh_token);

  // Dedup on (provider, account_email) so a user reconnecting the same Google
  // account doesn't accumulate dead oauth_credentials rows.
  const existingCred = await db.query.oauthCredentials.findFirst({
    where: and(
      eq(oauthCredentials.provider, "google_business_profile"),
      eq(oauthCredentials.accountEmail, accountEmail),
    ),
  });
  let credId: string;
  if (existingCred) {
    await db
      .update(oauthCredentials)
      .set({
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(oauthCredentials.id, existingCred.id));
    credId = existingCred.id;
  } else {
    const [cred] = await db
      .insert(oauthCredentials)
      .values({
        provider: "google_business_profile",
        accountEmail,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
      })
      .returning();
    credId = cred.id;
  }

  await db
    .update(locations)
    .set({ gbpOauthTokenId: credId })
    .where(eq(locations.id, locationId));

  // Discover the matching GBP account+location for this placeId using the
  // fresh access_token (saves a refresh round-trip).
  let gbpAccountId: string | null = null;
  let gbpLocationId: string | null = null;
  let discoveryError: string | null = null;
  try {
    const accounts = await listAccounts(tokens.access_token);
    outer: for (const account of accounts) {
      if (!account.name) continue;
      const gbpLocations = await listLocations(tokens.access_token, account.name);
      for (const loc of gbpLocations) {
        if (loc.metadata?.placeId === location.placeId && loc.name) {
          gbpAccountId = account.name.replace(/^accounts\//, "");
          gbpLocationId = loc.name.replace(/^locations\//, "");
          break outer;
        }
      }
    }
    if (!gbpAccountId || !gbpLocationId) {
      discoveryError = "no_match";
    }
  } catch (e) {
    console.error("GBP discovery failed", { locationId, error: e });
    discoveryError = "discovery_failed";
  }

  if (gbpAccountId && gbpLocationId) {
    await db
      .update(locations)
      .set({ gbpAccountId, gbpLocationId })
      .where(eq(locations.id, locationId));
  }

  if (discoveryError) {
    return redirectWith(url, slug, locationId, {
      gbp_link: discoveryError === "no_match" ? "no_match" : "failed",
      reason: discoveryError,
    });
  }

  // Token is linked. Kick off an immediate review poll + 90d performance
  // backfill so the dashboard tiles have data on day one. Both are best-
  // effort: a poll failure still surfaces as "linked" because the
  // connection itself succeeded; the user can hit Sync reviews manually.
  try {
    await pollReviewsForLocation(locationId);
  } catch (e) {
    console.error("[oauth callback] initial review poll failed:", e);
  }
  try {
    await pullPerformanceForLocation(locationId, 90);
  } catch (e) {
    console.error("[oauth callback] performance backfill failed:", e);
  }

  return redirectWith(url, slug, locationId, { gbp_link: "linked" });
}
