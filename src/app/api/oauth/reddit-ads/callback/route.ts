import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials } from "@/lib/db/schema";
import { encryptString, hmacVerify } from "@/lib/crypto";
import { exchangeRedditCode, getRedditMe } from "@/lib/reddit-ads";
import { REDDIT_ADS_PROVIDER } from "@/lib/reddit-ads-token";

export const runtime = "nodejs";
export const maxDuration = 60;

type StatePayload = { nonce: string; exp: number };

function verifyState(state: string): StatePayload | null {
  const dot = state.indexOf(".");
  if (dot < 0) return null;
  const payloadEncoded = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (!payloadEncoded || !sig) return null;
  if (!hmacVerify(payloadEncoded, sig)) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

function redirectWith(origin: URL, params: Record<string, string>) {
  const dest = new URL("/reddit/accounts", origin);
  for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
  return NextResponse.redirect(dest);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    // e.g. access_denied when the user clicks "Decline" on Reddit.
    return redirectWith(url, { reddit_link: "failed", reason: errorParam });
  }
  if (!code || !state || !verifyState(state)) {
    return redirectWith(url, { reddit_link: "failed", reason: "invalid_state" });
  }

  const redirectUri = process.env.REDDIT_ADS_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.json({ error: "REDDIT_ADS_REDIRECT_URI not set" }, { status: 500 });
  }

  let tokens;
  try {
    tokens = await exchangeRedditCode({ code, redirectUri });
  } catch (e) {
    console.error("Reddit Ads OAuth token exchange failed", e);
    return redirectWith(url, { reddit_link: "failed", reason: errorText(e).slice(0, 300) });
  }
  if (!tokens.refreshToken) {
    return redirectWith(url, { reddit_link: "no_refresh_token" });
  }

  // Identify the connection by Reddit username. Save the token even if /me
  // fails (e.g. the app isn't yet approved for the Ads API) so the
  // diagnostic route can still be pointed at it — same "save the token
  // first" choice as the Google Ads callback.
  let username = "unknown";
  let meError: string | null = null;
  try {
    const me = await getRedditMe(tokens.accessToken);
    username = me.reddit_username || "unknown";
  } catch (e) {
    console.error("Reddit Ads GET /me failed", e);
    meError = errorText(e);
  }

  const values = {
    accessTokenEncrypted: encryptString(tokens.accessToken),
    refreshTokenEncrypted: encryptString(tokens.refreshToken),
    expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
  };
  const existing = await db.query.oauthCredentials.findFirst({
    where: and(
      eq(oauthCredentials.provider, REDDIT_ADS_PROVIDER),
      eq(oauthCredentials.accountEmail, username),
    ),
  });
  if (existing) {
    await db
      .update(oauthCredentials)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(oauthCredentials.id, existing.id));
  } else {
    await db.insert(oauthCredentials).values({
      provider: REDDIT_ADS_PROVIDER,
      accountEmail: username,
      ...values,
    });
  }

  if (meError) {
    return redirectWith(url, { reddit_link: "me_failed", reason: meError.slice(0, 300) });
  }
  return redirectWith(url, { reddit_link: "connected", user: username });
}
