import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials } from "@/lib/db/schema";
import { decryptString, encryptString } from "@/lib/crypto";
import { refreshRedditAccessToken } from "@/lib/reddit-ads";

// Reddit Ads tokens live in the shared oauth_credentials table under this
// provider. accountEmail holds the Reddit *username* (from GET /me), not an
// email: Reddit's /me email is nullable, and the username is what identifies
// the connection in Reddit's own UI.
export const REDDIT_ADS_PROVIDER = "reddit_ads";

// Refresh a little early so a token can't expire mid-sync.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export type RedditCredential = typeof oauthCredentials.$inferSelect;

// One agency-wide connection is the expected case; newest first if more
// than one Reddit user has been connected.
export function listRedditCredentials(): Promise<RedditCredential[]> {
  return db.query.oauthCredentials.findMany({
    where: eq(oauthCredentials.provider, REDDIT_ADS_PROVIDER),
    orderBy: desc(oauthCredentials.updatedAt),
  });
}

// Unlike gbp.ts / google-ads.ts, which mint a fresh access token from the
// refresh token on every call, Reddit tokens are cached in the existing
// access_token_encrypted / expires_at columns: a refresh response may carry
// a replacement refresh token, which has to be persisted anyway.
//
// Deliberately leaves updatedAt alone — listRedditCredentials orders by it
// to mean "most recently connected", and a background refresh isn't a
// reconnect.
export async function getRedditAccessToken(cred: RedditCredential): Promise<string> {
  if (cred.expiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
    return decryptString(cred.accessTokenEncrypted);
  }
  const refreshed = await refreshRedditAccessToken(decryptString(cred.refreshTokenEncrypted));
  await db
    .update(oauthCredentials)
    .set({
      accessTokenEncrypted: encryptString(refreshed.accessToken),
      expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      ...(refreshed.refreshToken
        ? { refreshTokenEncrypted: encryptString(refreshed.refreshToken) }
        : {}),
    })
    .where(eq(oauthCredentials.id, cred.id));
  return refreshed.accessToken;
}
