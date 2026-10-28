import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { hmacSign } from "@/lib/crypto";
import { buildRedditAuthorizeUrl } from "@/lib/reddit-ads";

export const runtime = "nodejs";

const STATE_TTL_MS = 10 * 60 * 1000;

// Starts the one-time Reddit Ads connection. Unlike the Google Ads flow
// there's no client id in the state: one Reddit login covers every ad
// account the agency can see, so the token isn't bound to any client.
export async function GET() {
  const appId = process.env.REDDIT_ADS_APP_ID;
  const redirectUri = process.env.REDDIT_ADS_REDIRECT_URI;
  if (!appId || !redirectUri) {
    return NextResponse.json(
      { error: "REDDIT_ADS_APP_ID / REDDIT_ADS_REDIRECT_URI not set" },
      { status: 500 },
    );
  }

  const payload = {
    nonce: randomBytes(16).toString("base64url"),
    exp: Date.now() + STATE_TTL_MS,
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const state = `${payloadEncoded}.${hmacSign(payloadEncoded)}`;

  return NextResponse.redirect(buildRedditAuthorizeUrl({ appId, redirectUri, state }));
}
