// WhatsApp inbox: everything that touches the database. The Graph API client
// is whatsapp.ts (pure), the webhook parsing is whatsapp-webhook.ts (pure).

import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  whatsappConversations,
  whatsappMessages,
  whatsappNumbers,
  type WhatsappConversation,
} from "@/lib/db/schema";
import {
  canReplyFreeform,
  previewText,
  statusRank,
  type InboundMessage,
  type StatusUpdate,
} from "./whatsapp-webhook";
import {
  listPhoneNumbers,
  listWabas,
  registerPhoneNumber,
  sendText,
  subscribeAppToWaba,
  type GraphPhoneNumber,
  type RawGraphResponse,
} from "./whatsapp";

// Same reason as the sync modules' copies: a bare (err as Error).message is
// undefined for a non-Error rejection.
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// SQL mirror of statusRank() so the forward-only check happens inside the
// UPDATE itself, with no read-then-write race between two status webhooks.
const STATUS_RANK_SQL = sql`CASE ${whatsappMessages.status}
  WHEN 'sending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
  WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE -1 END`;

async function ensureNumber(m: InboundMessage): Promise<string> {
  const [row] = await db
    .insert(whatsappNumbers)
    .values({
      phoneNumberId: m.phoneNumberId,
      wabaId: m.wabaId,
      displayPhoneNumber: m.displayPhoneNumber,
    })
    .onConflictDoUpdate({
      target: whatsappNumbers.phoneNumberId,
      // Never touch label/isActive; only fill what discovery hasn't.
      set: {
        wabaId: sql`coalesce(${whatsappNumbers.wabaId}, excluded.waba_id)`,
        displayPhoneNumber: sql`coalesce(${whatsappNumbers.displayPhoneNumber}, excluded.display_phone_number)`,
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: whatsappNumbers.id });
  return row.id;
}

type Identity = {
  userId: string | null;
  waId: string | null;
  profileName: string | null;
  username: string | null;
};

function identityMatch(numberId: string, who: Identity) {
  const byUser = who.userId ? eq(whatsappConversations.userId, who.userId) : undefined;
  const byWa = who.waId ? eq(whatsappConversations.waId, who.waId) : undefined;
  return and(eq(whatsappConversations.numberId, numberId), or(byUser, byWa));
}

// Finds the conversation by BSUID or phone and fills in whichever identifier
// it was missing; creates it otherwise. A concurrent delivery for the same
// new customer can win the insert, so a unique violation re-reads.
async function upsertConversation(numberId: string, who: Identity): Promise<WhatsappConversation> {
  const find = () =>
    db.query.whatsappConversations.findFirst({
      where: identityMatch(numberId, who),
      // Prefer the BSUID match when both identifiers hit different rows.
      orderBy: sql`coalesce(${whatsappConversations.userId} = ${who.userId ?? ""}, false) DESC`,
    });

  const existing = await find();
  if (existing) {
    const patch: Partial<WhatsappConversation> = {};
    if (!existing.userId && who.userId) patch.userId = who.userId;
    if (!existing.waId && who.waId) patch.waId = who.waId;
    if (who.profileName && who.profileName !== existing.profileName) patch.profileName = who.profileName;
    if (who.username && who.username !== existing.username) patch.username = who.username;
    if (Object.keys(patch).length === 0) return existing;
    try {
      const [updated] = await db
        .update(whatsappConversations)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(whatsappConversations.id, existing.id))
        .returning();
      return updated ?? existing;
    } catch (err) {
      // The filled-in identifier already belongs to another row (two rows
      // for one person, from before both ids were known). Keep this one as is.
      console.warn(`[whatsapp] could not merge identity into conversation ${existing.id}: ${stringifyError(err)}`);
      return existing;
    }
  }

  const inserted = await db
    .insert(whatsappConversations)
    .values({ numberId, ...who })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const raced = await find();
  if (!raced) throw new Error("conversation insert conflicted but no row found");
  return raced;
}

export async function ingestInbound(m: InboundMessage): Promise<boolean> {
  const numberId = await ensureNumber(m);
  const convo = await upsertConversation(numberId, m);
  const inserted = await db
    .insert(whatsappMessages)
    .values({
      conversationId: convo.id,
      wamid: m.wamid,
      direction: "in",
      type: m.type,
      body: m.body,
      mediaId: m.mediaId,
      mediaMimeType: m.mediaMimeType,
      mediaFilename: m.mediaFilename,
      referral: m.referral,
      status: "received",
      sentAt: m.sentAt,
      raw: m.raw,
    })
    .onConflictDoNothing()
    .returning({ id: whatsappMessages.id });
  if (inserted.length === 0) return false; // a retry of a delivery we already have

  // Cast explicitly: inside raw sql the driver would otherwise send an untyped param.
  const at = sql`${m.sentAt.toISOString()}::timestamptz`;
  await db
    .update(whatsappConversations)
    .set({
      lastInboundAt: sql`greatest(${whatsappConversations.lastInboundAt}, ${at})`,
      // Only the newest message sets the preview; batches can arrive out of order.
      lastMessagePreview: sql`CASE WHEN ${whatsappConversations.lastMessageAt} IS NULL OR ${whatsappConversations.lastMessageAt} <= ${at}
        THEN ${previewText(m.type, m.body)} ELSE ${whatsappConversations.lastMessagePreview} END`,
      lastMessageAt: sql`greatest(${whatsappConversations.lastMessageAt}, ${at})`,
      unreadCount: sql`${whatsappConversations.unreadCount} + 1`,
      ...(m.referral ? { lastReferral: m.referral } : {}),
      updatedAt: new Date(),
    })
    .where(eq(whatsappConversations.id, convo.id));
  return true;
}

// Known gap: a status for a message sent from the inbox can, in principle,
// arrive before sendReply has inserted the row (the wamid only exists once
// Graph answers). That status is then dropped and the row stays "sent". In
// practice Meta's first status lands well after the insert.
export async function applyStatus(s: StatusUpdate): Promise<boolean> {
  const rank = statusRank(s.status);
  if (rank < 0) return false;
  const updated = await db
    .update(whatsappMessages)
    .set({
      status: s.status,
      statusUpdatedAt: s.at,
      ...(s.errorMessage ? { errorMessage: s.errorMessage } : {}),
    })
    .where(and(eq(whatsappMessages.wamid, s.wamid), sql`${STATUS_RANK_SQL} < ${rank}`))
    .returning({ id: whatsappMessages.id });
  return updated.length > 0;
}

// Upserts one number as Meta lists it. Returns true when the row is new.
// Labels and the active flag are ours and never overwritten.
async function upsertDiscoveredNumber(wabaId: string, n: GraphPhoneNumber): Promise<boolean> {
  const values = {
    wabaId,
    displayPhoneNumber: n.display_phone_number ?? null,
    verifiedName: n.verified_name ?? null,
    qualityRating: n.quality_rating ?? null,
    platformType: n.platform_type ?? null,
    codeVerificationStatus: n.code_verification_status ?? null,
    lastSeenAt: new Date(),
  };
  const [row] = await db
    .insert(whatsappNumbers)
    .values({ phoneNumberId: n.id, ...values })
    .onConflictDoUpdate({
      target: whatsappNumbers.phoneNumberId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ created: sql<boolean>`(xmax = 0)` });
  return row?.created === true;
}

// --- Discovery -------------------------------------------------------------

export type DiscoveryResult = {
  wabas: number;
  found: number;
  added: number;
  subscribed: number;
  errors: string[];
};

// "Refresh from Meta" on /whatsapp/numbers: lists every WABA in the
// portfolio, subscribes our app to each one's webhooks (idempotent on Meta's
// side; without it no message for that WABA ever reaches us), and upserts its
// numbers. Labels and the active flag are ours and never overwritten.
export async function runWhatsappDiscovery(): Promise<DiscoveryResult> {
  const businessId = process.env.WHATSAPP_BUSINESS_ID;
  if (!businessId) throw new Error("WHATSAPP_BUSINESS_ID is not set");

  const { wabas, errors } = await listWabas(businessId);
  let found = 0;
  let added = 0;
  let subscribed = 0;
  for (const waba of wabas) {
    try {
      if (await subscribeAppToWaba(waba.id)) subscribed++;
    } catch (err) {
      errors.push(`subscribe ${waba.name ?? waba.id}: ${stringifyError(err)}`);
    }
    let numbers;
    try {
      numbers = await listPhoneNumbers(waba.id);
    } catch (err) {
      errors.push(`numbers for ${waba.name ?? waba.id}: ${stringifyError(err)}`);
      continue;
    }
    for (const n of numbers) {
      found++;
      if (await upsertDiscoveredNumber(waba.id, n)) added++;
    }
  }
  return { wabas: wabas.length, found, added, subscribed, errors };
}

// --- Sending ---------------------------------------------------------------

export class ReplyRefused extends Error {}

export async function sendReply(conversationId: string, body: string, sentByEmail: string | null) {
  const convo = await db.query.whatsappConversations.findFirst({
    where: eq(whatsappConversations.id, conversationId),
  });
  if (!convo) throw new ReplyRefused("Conversation not found");
  const number = await db.query.whatsappNumbers.findFirst({
    where: eq(whatsappNumbers.id, convo.numberId),
  });
  if (!number) throw new ReplyRefused("Number not found");
  if (!canReplyFreeform(convo.lastInboundAt)) {
    throw new ReplyRefused(
      "The 24-hour reply window is closed. WhatsApp only allows an approved template message until the customer writes again.",
    );
  }
  // Sending by BSUID alone isn't something we've confirmed Meta accepts yet,
  // so a username-only contact (no phone on file) can't be answered from here.
  if (!convo.waId) {
    throw new ReplyRefused("This contact has no phone number on file (username-only), so it can't be replied to from here yet.");
  }

  const result = await sendText(number.phoneNumberId, convo.waId, body);
  const now = new Date();
  const [message] = await db
    .insert(whatsappMessages)
    .values({
      conversationId: convo.id,
      wamid: result.wamid,
      direction: "out",
      type: "text",
      body,
      status: "sent",
      sentByEmail,
      sentAt: now,
    })
    .onConflictDoNothing()
    .returning();
  await db
    .update(whatsappConversations)
    .set({
      lastMessageAt: now,
      lastMessagePreview: previewText("text", body),
      unreadCount: 0,
      updatedAt: now,
    })
    .where(eq(whatsappConversations.id, convo.id));
  return message;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({ unreadCount: 0 })
    .where(and(eq(whatsappConversations.id, conversationId), sql`${whatsappConversations.unreadCount} > 0`));
}

// --- Cloud API registration --------------------------------------------------

export type RegisterOutcome = {
  meta: RawGraphResponse;
  // The number as Meta lists it right after the call, or why that failed.
  refreshed: { platformType: string | null; codeVerificationStatus: string | null } | null;
  refreshError: string | null;
};

// Re-reads one number from its WABA's phone_numbers list (the same call
// discovery makes) and stores it.
export async function refreshNumber(numberRowId: string) {
  const row = await db.query.whatsappNumbers.findFirst({ where: eq(whatsappNumbers.id, numberRowId) });
  if (!row) throw new Error("Number not found");
  if (!row.wabaId) throw new Error("This number has no WhatsApp account id yet; run Refresh from Meta");
  const n = (await listPhoneNumbers(row.wabaId)).find((x) => x.id === row.phoneNumberId);
  if (!n) throw new Error("Meta no longer lists this number under its WhatsApp account");
  await upsertDiscoveredNumber(row.wabaId, n);
  return { platformType: n.platform_type ?? null, codeVerificationStatus: n.code_verification_status ?? null };
}

export class RegisterRefused extends Error {}

// Only offered for numbers Meta reports as NOT_APPLICABLE (not registered on
// any platform). Re-registering a number that is already live on the Cloud
// API is refused here rather than risked.
export async function registerNumberForCloudApi(numberRowId: string, pin: string): Promise<RegisterOutcome> {
  const row = await db.query.whatsappNumbers.findFirst({ where: eq(whatsappNumbers.id, numberRowId) });
  if (!row) throw new RegisterRefused("Number not found");
  if (row.platformType !== "NOT_APPLICABLE") {
    throw new RegisterRefused(
      `Only numbers with platform type NOT_APPLICABLE can be registered here (this one is ${row.platformType ?? "unknown"}). Run Refresh from Meta if that looks stale.`,
    );
  }
  const meta = await registerPhoneNumber(row.phoneNumberId, pin);
  try {
    return { meta, refreshed: await refreshNumber(row.id), refreshError: null };
  } catch (err) {
    return { meta, refreshed: null, refreshError: stringifyError(err) };
  }
}
