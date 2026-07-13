import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { lsaClients, oauthCredentials } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { discoverGoogleAdsCustomers } from "@/lib/google-ads";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  oauthCredentialId: z.string().uuid(),
});

// Attach an already-saved Google Ads OAuth credential to this LSA client,
// skipping the full re-OAuth round-trip (there is no fresh-OAuth entry
// point for LSA — accounts@everconvert.com's existing credential, already
// used by PPC, is reused here). Then run customer discovery identically
// to PPC's attach-ads route so we either auto-bind a customer id (1
// visible), prompt the operator to enter one (>1), or report what went
// wrong (0 / API error).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }

  const lsaClient = await db.query.lsaClients.findFirst({
    where: eq(lsaClients.id, id),
  });
  if (!lsaClient) {
    return NextResponse.json({ error: "lsa client not found" }, { status: 404 });
  }

  const cred = await db.query.oauthCredentials.findFirst({
    where: and(
      eq(oauthCredentials.id, parsed.oauthCredentialId),
      eq(oauthCredentials.provider, "google_ads"),
    ),
  });
  if (!cred) {
    return NextResponse.json(
      { error: "google_ads credential not found" },
      { status: 404 },
    );
  }

  const refreshToken = decryptString(cred.refreshTokenEncrypted);

  let autoBoundCustomerId: string | null = null;
  let status: "linked" | "needs_picker" | "no_customers" | "list_failed";
  let errorMessage: string | null = null;
  let discoveredCustomers: Array<{ id: string; name: string | null }> | null =
    null;
  try {
    const customers = await Promise.race([
      discoverGoogleAdsCustomers(refreshToken),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out after 25s")), 25000),
      ),
    ]);
    discoveredCustomers = customers;
    if (customers.length === 1) {
      autoBoundCustomerId = customers[0].id;
      status = "linked";
    } else if (customers.length === 0) {
      status = "no_customers";
    } else {
      status = "needs_picker";
    }
  } catch (e) {
    status = "list_failed";
    errorMessage = (e as Error).message;
  }

  await db
    .update(lsaClients)
    .set({
      googleAdsOauthTokenId: cred.id,
      ...(autoBoundCustomerId ? { googleAdsCustomerId: autoBoundCustomerId } : {}),
      ...(discoveredCustomers
        ? { googleAdsDiscoveredCustomersJson: discoveredCustomers }
        : {}),
      lastSyncError: errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(lsaClients.id, id));

  return NextResponse.json({
    status,
    customerId: autoBoundCustomerId,
    accountEmail: cred.accountEmail,
    errorMessage,
  });
}
