import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, Settings2 } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import {
  WhatsappAutoRefresh,
  WhatsappMarkRead,
  WhatsappNumberSelect,
  WhatsappThread,
  type ThreadMessage,
} from "@/components/whatsapp-inbox";
import { db } from "@/lib/db/client";
import { whatsappConversations, whatsappMessages, whatsappNumbers } from "@/lib/db/schema";
import { canReplyFreeform, serviceWindowClosesAt } from "@/lib/whatsapp-webhook";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "WhatsApp inbox" };

const UUID = /^[0-9a-f-]{36}$/i;
const TZ = "America/New_York";

function fmtWhen(d: Date | null, now: Date): string {
  if (!d) return "";
  const sameDay =
    d.toLocaleDateString("en-US", { timeZone: TZ }) === now.toLocaleDateString("en-US", { timeZone: TZ });
  return d.toLocaleString("en-US", {
    timeZone: TZ,
    ...(sameDay ? { timeStyle: "short" } : { month: "short", day: "numeric" }),
  });
}

function fmtFull(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function contactName(c: { profileName: string | null; username: string | null; waId: string | null }): string {
  return c.profileName ?? (c.username ? `@${c.username}` : null) ?? (c.waId ? `+${c.waId}` : "Unknown");
}

function numberName(n: { label: string | null; verifiedName: string | null; displayPhoneNumber: string | null } | null) {
  return n?.label ?? n?.verifiedName ?? n?.displayPhoneNumber ?? "Unknown number";
}

// Conversation list on the left, open thread on the right. On a phone only
// one shows at a time (?c= decides which).
export default async function WhatsappInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; n?: string }>;
}) {
  const { c, n } = await searchParams;
  const now = new Date();
  const selectedId = c && UUID.test(c) ? c : null;
  const numberFilter = n && UUID.test(n) ? n : null;

  const numbers = await db.query.whatsappNumbers.findMany({ orderBy: asc(whatsappNumbers.label) });
  const numberById = new Map(numbers.map((x) => [x.id, x]));

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

  const conversations = await db
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
    .limit(200);

  const selected = selectedId
    ? await db.query.whatsappConversations.findFirst({ where: eq(whatsappConversations.id, selectedId) })
    : null;
  const messages = selected
    ? (
        await db.query.whatsappMessages.findMany({
          where: eq(whatsappMessages.conversationId, selected.id),
          orderBy: desc(whatsappMessages.sentAt),
          limit: 300,
        })
      ).reverse()
    : [];

  const href = (convId: string | null) => {
    const p = new URLSearchParams();
    if (numberFilter) p.set("n", numberFilter);
    if (convId) p.set("c", convId);
    const s = p.toString();
    return s ? `/whatsapp?${s}` : "/whatsapp";
  };

  let disabledReason: string | null = null;
  if (selected) {
    if (!canReplyFreeform(selected.lastInboundAt, now)) {
      disabledReason = selected.lastInboundAt
        ? `Reply window closed ${fmtFull(serviceWindowClosesAt(selected.lastInboundAt)!)}. WhatsApp only allows an approved template until the customer writes again.`
        : "The customer hasn't messaged this number, so WhatsApp only allows an approved template.";
    } else if (!selected.waId) {
      disabledReason =
        "This contact uses a WhatsApp username and has no phone number on file, so it can't be replied to from here yet.";
    }
  }
  const windowCloses = selected ? serviceWindowClosesAt(selected.lastInboundAt) : null;

  const threadMessages: ThreadMessage[] = messages.map((m) => ({
    id: m.id,
    direction: m.direction === "out" ? "out" : "in",
    type: m.type,
    body: m.body,
    mediaId: m.mediaId,
    mediaFilename: m.mediaFilename,
    referral: (m.referral as ThreadMessage["referral"]) ?? null,
    status: m.status,
    errorMessage: m.errorMessage,
    sentByEmail: m.sentByEmail,
    sentAt: m.sentAt.toISOString(),
  }));

  return (
    <div className="space-y-4">
      <WhatsappAutoRefresh />
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

      <div className="grid h-[calc(100dvh-9.5rem)] min-h-[28rem] overflow-hidden rounded-xl border bg-background shadow-sm dark:bg-card dark:shadow-none md:grid-cols-[20rem_1fr]">
        {/* Conversation list */}
        <aside className={cn("flex min-h-0 flex-col border-r", selected && "hidden md:flex")}>
          {numberOptions.length > 1 && (
            <div className="border-b p-3">
              <WhatsappNumberSelect options={numberOptions} value={numberFilter} />
            </div>
          )}
          <ul className="flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <li className="p-4 text-sm text-muted-foreground">No conversations yet.</li>
            )}
            {conversations.map(({ whatsapp_conversations: conv, whatsapp_numbers: num }) => {
              const active = conv.id === selected?.id;
              const unread = conv.unreadCount > 0;
              return (
                <li key={conv.id}>
                  <Link
                    href={href(conv.id)}
                    className={cn(
                      "relative block border-b border-border/60 px-4 py-3 text-sm transition-colors",
                      active ? "bg-brand-muted dark:bg-muted" : "hover:bg-card dark:hover:bg-muted/50",
                    )}
                  >
                    {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-brand" />}
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate", unread ? "font-semibold" : "font-medium")}>
                        {contactName(conv)}
                      </span>
                      <span
                        className={cn(
                          "flex-shrink-0 text-[11px]",
                          unread ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {fmtWhen(conv.lastMessageAt, now)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                        {conv.lastMessagePreview}
                      </span>
                      {unread && (
                        <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-foreground">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {!numberFilter && <span className="truncate">{numberName(num)}</span>}
                      {conv.lastReferral ? (
                        <span className="flex-shrink-0 rounded bg-brand-muted px-1 font-medium text-foreground dark:bg-violet-500/[0.15] dark:text-violet-400">
                          Ad
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Thread */}
        <section className={cn("flex min-h-0 flex-col", !selected && "hidden md:flex")}>
          {!selected ? (
            <div className="m-auto p-6 text-sm text-muted-foreground">Pick a conversation.</div>
          ) : (
            <>
              <WhatsappMarkRead conversationId={selected.id} unread={selected.unreadCount} />
              <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={href(null)}
                    className="mb-1 inline-flex items-center text-xs text-muted-foreground hover:text-foreground md:hidden"
                  >
                    <ArrowLeft className="mr-1 h-3 w-3" /> Conversations
                  </Link>
                  <div className="truncate font-semibold">{contactName(selected)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      selected.waId ? `+${selected.waId}` : null,
                      selected.username ? `@${selected.username}` : null,
                      numberName(numberById.get(selected.numberId) ?? null),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {windowCloses && windowCloses > now && (
                  <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-brand-muted px-2.5 py-1 text-xs font-medium text-foreground dark:rounded-md dark:bg-green-500/[0.15] dark:px-2 dark:py-0.5 dark:text-green-400">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand dark:hidden" />
                    Can reply until {fmtFull(windowCloses)}
                  </span>
                )}
              </header>
              <WhatsappThread
                conversationId={selected.id}
                messages={threadMessages}
                nowIso={now.toISOString()}
                disabledReason={disabledReason}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
