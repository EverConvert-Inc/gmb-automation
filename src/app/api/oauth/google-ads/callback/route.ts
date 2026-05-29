import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials, ppcClients } from "@/lib/db/schema";
import { encryptString, hmacVerify } from "@/lib/crypto";
import { discoverGoogleAdsCustomers } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 60;

type StatePayload = { ppcClientId: string; nonce: string; exp: number };

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
    typeof payload.ppcClientId !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp < Date.now()
  ) {
    return null;
  }
  return payload;
}

function redirectWith(origin: URL, ppcClientId: string, params: Record<string, string>) {
  const dest = new URL(`/ppc/clients/${ppcClientId}`, origin);
  for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
  return NextResponse.redirect(dest);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const payload = state ? verifyState(state) : null;
  if (errorParam || !code || !payload) {
    // We don't know which ppcClient to redirect to without a valid state, so
    // fall back to the admin list.
    const dest = new URL("/ppc/clients", url);
    if (errorParam) dest.searchParams.set("ads_link", "failed");
    return NextResponse.redirect(dest);
  }
  const { ppcClientId } = payload;

  const clientId =
    process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ??
    process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Google Ads OAuth env not set" },
      { status: 500 },
    );
  }

  const ppcClient = await db.query.ppcClients.findFirst({
    where: eq(ppcClients.id, ppcClientId),
  });
  if (!ppcClient) {
    return NextResponse.json({ error: "ppc client not found" }, { status: 404 });
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
    const detail = await tokenRes.text();
    console.error("Google Ads OAuth token exchange failed", { status: tokenRes.status, detail });
    return redirectWith(url, ppcClientId, { ads_link: "failed" });
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  if (!tokens.refresh_token) {
    return redirectWith(url, ppcClientId, { ads_link: "no_refresh_token" });
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

  const existingCred = await db.query.oauthCredentials.findFirst({
    where: and(
      eq(oauthCredentials.provider, "google_ads"),
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
        provider: "google_ads",
        accountEmail,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
      })
      .returning();
    credId = cred.id;
  }

  // Try to auto-bind a customer id. If the connected user manages exactly
  // one Google Ads account, we link it immediately. Otherwise we save the
  // token and hand the user back to the admin page with a picker. Always
  // save the token first so a customer-discovery failure doesn't force the
  // user back through OAuth — they can paste a customer id manually.
  let autoBoundCustomerId: string | null = null;
  let customerError: string | null = null;
  let customerErrorMessage: string | null = null;
  let discoveredCustomers: Array<{ id: string; name: string | null }> | null =
    null;
  try {
    // Wrap with a hard timeout — google-ads-api uses gRPC under the hood
    // and can hang indefinitely on network blips; without this the user
    // sits on a spinner with no feedback.
    const customers = await Promise.race([
      discoverGoogleAdsCustomers(tokens.refresh_token),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Timed out after 25s")),
          25000,
        ),
      ),
    ]);
    discoveredCustomers = customers;
    if (customers.length === 1) {
      autoBoundCustomerId = customers[0].id;
    } else if (customers.length === 0) {
      customerError = "no_customers";
    } else {
      customerError = "needs_picker";
    }
  } catch (e) {
    console.error("discoverGoogleAdsCustomers failed", e);
    customerError = "list_failed";
    customerErrorMessage = (e as Error).message;
  }

  await db
    .update(ppcClients)
    .set({
      googleAdsOauthTokenId: credId,
      ...(autoBoundCustomerId ? { googleAdsCustomerId: autoBoundCustomerId } : {}),
      ...(discoveredCustomers
        ? { googleAdsDiscoveredCustomersJson: discoveredCustomers }
        : {}),
      lastSyncError: customerErrorMessage,
      updatedAt: new Date(),
    })
    .where(eq(ppcClients.id, ppcClientId));

  if (customerError === "list_failed" && customerErrorMessage) {
    return redirectWith(url, ppcClientId, {
      ads_link: "list_failed",
      reason: customerErrorMessage.slice(0, 300),
    });
  }
  if (customerError) {
    return redirectWith(url, ppcClientId, { ads_link: customerError });
  }
  return redirectWith(url, ppcClientId, {
    ads_link: autoBoundCustomerId ? "linked" : "needs_picker",
  });
}
