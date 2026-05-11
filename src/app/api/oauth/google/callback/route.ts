import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { locations, oauthCredentials } from "@/lib/db/schema";
import { encryptString } from "@/lib/crypto";
import { findGbpLocationByPlaceId } from "@/lib/gbp";
import { pollReviewsForLocation } from "@/lib/reviews";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
  if (!code || !state) {
    return NextResponse.json({ error: "missing code or state" }, { status: 400 });
  }
  const locationId = state;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "OAuth env not set" }, { status: 500 });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: `Token exchange failed: ${await tokenRes.text()}` },
      { status: 502 },
    );
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  if (!tokens.refresh_token) {
    return NextResponse.json(
      { error: "No refresh_token returned. Revoke and retry with prompt=consent." },
      { status: 400 },
    );
  }

  const userInfoRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  const userInfo = (await userInfoRes.json()) as { email?: string };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const refreshTokenEncrypted = encryptString(tokens.refresh_token);
  const [cred] = await db
    .insert(oauthCredentials)
    .values({
      provider: "google_business_profile",
      accountEmail: userInfo.email ?? "unknown",
      accessTokenEncrypted: encryptString(tokens.access_token),
      refreshTokenEncrypted,
      expiresAt,
    })
    .returning();

  // Load the location we're linking so we can match by placeId
  const location = await db.query.locations.findFirst({
    where: eq(locations.id, locationId),
  });
  if (!location) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }

  await db
    .update(locations)
    .set({ gbpOauthTokenId: cred.id })
    .where(eq(locations.id, locationId));

  // Best-effort: discover the matching GBP account+location for this placeId,
  // persist the IDs, then run a one-shot poll so reviews show up immediately
  // instead of waiting for the daily cron. Surface the outcome via a query
  // param on the redirect so the dashboard can render an explanatory banner.
  let outcome: "linked" | "no_match" | "failed" = "failed";
  try {
    const match = await findGbpLocationByPlaceId({
      refreshTokenEncrypted,
      placeId: location.placeId,
    });
    if (!match) {
      outcome = "no_match";
    } else {
      await db
        .update(locations)
        .set({
          gbpAccountId: match.accountId,
          gbpLocationId: match.locationId,
        })
        .where(eq(locations.id, locationId));
      try {
        await pollReviewsForLocation(locationId);
        outcome = "linked";
      } catch (err) {
        console.error("[oauth callback] initial review poll failed:", err);
        outcome = "linked";
      }
    }
  } catch (err) {
    console.error("[oauth callback] GBP location discovery failed:", err);
  }

  // Redirect back to the originating client's dashboard with the new tab
  // selected and the sync outcome surfaced.
  const clientRow = await db.query.clients.findFirst({
    where: (cols, ops) => ops.eq(cols.id, location.clientId),
    columns: { slug: true },
  });
  const redirectUrl = new URL(
    clientRow ? `/clients/${clientRow.slug}` : "/clients",
    url,
  );
  if (clientRow) {
    redirectUrl.searchParams.set("location", locationId);
    redirectUrl.searchParams.set("gbp_link", outcome);
  }
  return NextResponse.redirect(redirectUrl);
}
