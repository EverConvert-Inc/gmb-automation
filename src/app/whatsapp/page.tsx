import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import { Settings2 } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { WhatsappInbox } from "@/components/whatsapp-inbox";
import { db } from "@/lib/db/client";
import { whatsappConversations, whatsappNumbers } from "@/lib/db/schema";
import { contactName, numberName, type ConversationItem } from "@/lib/whatsapp-display";
import { getThread } from "@/lib/whatsapp-inbox";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "WhatsApp inbox" };

const UUID = /^[0-9a-f-]{36}$/i;

// Server side only renders the conversation list (and the thread for a direct
// link). Switching chats happens in the browser — see WhatsappInbox.
export default async function WhatsappInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; n?: string }>;
}) {
  const { c, n } = await searchParams;
  const now = new Date();
  const selectedId = c && UUID.test(c) ? c : null;
  const numberFilter = n && UUID.test(n) ? n : null;

  const [numbers, rows, initialThread] = await Promise.all([
    db.query.whatsappNumbers.findMany({ orderBy: asc(whatsappNumbers.label) }),
    db
      .select()
      .from(whatsappConversations)
      .innerJoin(whatsappNumbers, eq(whatsappNumbers.id, whatsappConversations.numberId))
      .where(
        and(
          eq(whatsappNumbers.isActive, true),
          numberFilter ? eq(whatsappConversations.numberId, numberFilter) : undefined,
        ),
      )
      .orderBy(sql`${whatsappConversations.lastMessageAt} desc nulls last`)
      .limit(200),
    selectedId ? getThread(selectedId, now) : Promise.resolve(null),
  ]);

  // Several numbers can share a label (one client, two numbers), so the
  // dropdown adds the phone number when a name repeats.
  const activeNumbers = numbers.filter((x) => x.isActive);
  const nameCounts = new Map<string, number>();
  for (const x of activeNumbers) nameCounts.set(numberName(x), (nameCounts.get(numberName(x)) ?? 0) + 1);
  const numberOptions = activeNumbers
    .map((x) => ({
      id: x.id,
      label:
        (nameCounts.get(numberName(x)) ?? 0) > 1 && x.displayPhoneNumber
          ? `${numberName(x)} · ${x.displayPhoneNumber}`
          : numberName(x),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const conversations: ConversationItem[] = rows.map(({ whatsapp_conversations: conv, whatsapp_numbers: num }) => ({
    id: conv.id,
    name: contactName(conv),
    preview: conv.lastMessagePreview,
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    unreadCount: conv.unreadCount,
    numberName: numberName(num),
    isAd: conv.lastReferral != null,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <Link href="/whatsapp/numbers" className={buttonClasses("outline", "sm")}>
          <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Numbers
        </Link>
      </div>

      {numbers.length === 0 && (
        <Banner tone="info" title="No WhatsApp numbers yet">
          Set up the connection and pull in your numbers on the{" "}
          <Link href="/whatsapp/numbers" className="underline">
            Numbers page
          </Link>
          .
        </Banner>
      )}

      <WhatsappInbox
        conversations={conversations}
        numberOptions={numberOptions}
        numberFilter={numberFilter}
        initialThread={initialThread}
        nowIso={now.toISOString()}
      />
    </div>
  );
}
