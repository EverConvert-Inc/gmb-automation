import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients, oauthCredentials } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { discoverGoogleAdsCustomers } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 60;

// Re-runs discovery (listAccessibleCustomers + descriptive-name lookups)
// against the saved Google Ads refresh token and refreshes the dropdown
// cache. Lets the operator pick up newly-granted Ads access without
// re-OAuthing.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const client = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, id),
  });
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!client.googleAdsOauthTokenId) {
    return NextResponse.json(
      { error: "Google Ads not connected for this client" },
      { status: 400 },
    );
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId),
  });
  if (!cred) {
    return NextResponse.json(
      { error: "OAuth credential row missing" },
      { status: 500 },
    );
  }

  const refreshToken = decryptString(cred.refreshTokenEncrypted);
  try {
    const customers = await Promise.race([
      discoverGoogleAdsCustomers(refreshToken, {
        extraManagerId: process.env.GOOGLE_ADS_LSA_MANAGER_ID,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out after 25s")), 25000),
      ),
    ]);
    await db
      .update(lsaClients)
      .set({
        googleAdsDiscoveredCustomersJson: customers,
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(lsaClients.id, id));
    return NextResponse.json({
      count: customers.length,
      customers,
    });
  } catch (err) {
    const msg = (err as Error).message;
    await db
      .update(lsaClients)
      .set({ lastSyncError: msg })
      .where(eq(lsaClients.id, id));
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
