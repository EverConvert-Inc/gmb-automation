import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { hmacSign } from "@/lib/crypto";
import { GOOGLE_ADS_OAUTH_SCOPES } from "@/lib/google-ads";

export const runtime = "nodejs";

const STATE_TTL_MS = 10 * 60 * 1000;

// Ads needs the user's email so we can dedup oauth_credentials by account.
const SCOPES = [...GOOGLE_ADS_OAUTH_SCOPES, "openid", "email"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ppcClientId = url.searchParams.get("ppcClientId");
  if (!ppcClientId) {
    return NextResponse.json(
      { error: "ppcClientId required" },
      { status: 400 },
    );
  }
  // Reuse the existing Google OAuth client when no Ads-specific override is
  // configured. The redirect URI for this flow points at the Ads callback
  // regardless.
  const clientId =
    process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      {
        error:
          "GOOGLE_(ADS_)OAUTH_CLIENT_ID / GOOGLE_ADS_OAUTH_REDIRECT_URI not set",
      },
      { status: 500 },
    );
  }

  const payload = {
    ppcClientId,
    nonce: randomBytes(16).toString("base64url"),
    exp: Date.now() + STATE_TTL_MS,
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const state = `${payloadEncoded}.${hmacSign(payloadEncoded)}`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  return NextResponse.redirect(authUrl.toString());
}
