import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { locations, oauthCredentials } from "@/lib/db/schema";
import { encryptString } from "@/lib/crypto";

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
  const [cred] = await db
    .insert(oauthCredentials)
    .values({
      provider: "google_business_profile",
      accountEmail: userInfo.email ?? "unknown",
      accessTokenEncrypted: encryptString(tokens.access_token),
      refreshTokenEncrypted: encryptString(tokens.refresh_token),
      expiresAt,
    })
    .returning();

  await db
    .update(locations)
    .set({ gbpOauthTokenId: cred.id })
    .where(eq(locations.id, locationId));

  const dest = new URL("/clients", url);
  return NextResponse.redirect(dest);
}
