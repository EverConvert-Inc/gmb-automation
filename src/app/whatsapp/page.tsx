import Link from "next/link";
import type { Metadata } from "next";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, Check, CheckCheck, Clock, Megaphone, Settings2, XCircle } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import {
  WhatsappAutoRefresh,
  WhatsappComposer,
  WhatsappMarkRead,
  WhatsappScrollToEnd,
} from "@/components/whatsapp-inbox";
import { db } from "@/lib/db/client";
import {
  whatsappConversations,
  whatsappMessages,
  whatsappNumbers,
  type WhatsappMessage,
} from "@/lib/db/schema";
import { canReplyFreeform, serviceWindowClosesAt } from "@/lib/whatsapp-webhook";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "WhatsApp inbox" };

const UUID = /^[0-9a-f-]{36}$/i;

function fmtWhen(d: Date | null, now: Date): string {
  if (!d) return "";
  const sameDay =
    d.toLocaleDateString("en-US", { timeZone: "America/New_York" }) ===
    now.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    ...(sameDay ? { timeStyle: "short" } : { month: "short", day: "numeric" }),
  });
}

function fmtFull(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
}

function contactName(c: { profileName: string | null; username: string | null; waId: string | null }): string {
  return c.profileName ?? (c.username ? `@${c.username}` : null) ?? (c.waId ? `+${c.waId}` : "Unknown");
}

function numberName(n: { label: string | null; verifiedName: string | null; displayPhoneNumber: string | null } | null) {
  return n?.label ?? n?.verifiedName ?? n?.displayPhoneNumber ?? "Unknown number";
}

type Referral = { source_id?: string; source_url?: string; headline?: string; body?: string; source_type?: string };

function ReferralNote({ referral }: { referral: Referral }) {
  return (
    <div className="mb-1 rounded border border-border/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
      <Megaphone className="mr-1 inline h-3 w-3" />
      From {referral.source_type === "ad" ? "ad" : (referral.source_type ?? "referral")}
      {referral.headline ? `: ${referral.headline}` : ""}
      {referral.source_id && <span className="ml-1 font-mono">#{referral.source_id}</span>}
    </div>
  );
}

function StatusIcon({ m }: { m: WhatsappMessage }) {
  if (m.direction !== "out") return null;
  switch (m.status) {
    case "read":
      return <CheckCheck className="h-3.5 w-3.5 text-sky-500" aria-label="Read" />;
    case "delivered":
      return <CheckCheck className="h-3.5 w-3.5" aria-label="Delivered" />;
    case "sent":
      return <Check className="h-3.5 w-3.5" aria-label="Sent" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-label="Failed" />;
    default:
      return <Clock className="h-3.5 w-3.5" aria-label="Sending" />;
  }
}

function MessageBody({ m }: { m: WhatsappMessage }) {
  const src = m.mediaId ? `/api/whatsapp/media/${encodeURIComponent(m.mediaId)}` : null;
  return (
    <>
      {src && m.type === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy, not optimisable
        <img src={src} alt={m.body ?? "Photo"} className="mb-1 max-h-72 rounded" loading="lazy" />
      )}
      {src && m.type === "sticker" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Sticker" className="h-28 w-28" loading="lazy" />
      )}
      {src && m.type === "audio" && <audio controls preload="none" src={src} className="max-w-full" />}
      {src && m.type === "video" && <video controls preload="none" src={src} className="mb-1 max-h-72 rounded" />}
      {src && m.type === "document" && (
        <a href={src} target="_blank" rel="noreferrer" className="mb-1 block underline">
          {m.mediaFilename ?? "Document"}
        </a>
      )}
      {m.body ? (
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
      ) : (
        !src && <p className="italic text-muted-foreground">[{m.type}]</p>
      )}
    </>
  );
}

// Two panes: conversations on the left, the open thread on the right. On a
// phone only one shows at a time (?c= decides which).
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

  const qs = (params: { c?: string | null; n?: string | null }) => {
    const p = new URLSearchParams();
    const nn = params.n === undefined ? numberFilter : params.n;
    if (nn) p.set("n", nn);
    if (params.c) p.set("c", params.c);
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
      disabledReason = "This contact uses a WhatsApp username and has no phone number on file, so it can't be replied to from here yet.";
    }
  }
  const windowCloses = selected ? serviceWindowClosesAt(selected.lastInboundAt) : null;

  return (
    <div className="space-y-4">
      <WhatsappAutoRefresh />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Messages to every client number. Updates every 10 seconds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {numbers.length > 1 && (
            <div className="flex flex-wrap gap-1">
              <Link
                href={qs({ n: null, c: null })}
                className={buttonClasses(numberFilter ? "ghost" : "outline", "sm")}
              >
                All numbers
              </Link>
              {numbers
                .filter((x) => x.isActive)
                .map((x) => (
                  <Link
                    key={x.id}
                    href={qs({ n: x.id, c: null })}
                    className={buttonClasses(numberFilter === x.id ? "outline" : "ghost", "sm")}
                  >
                    {numberName(x)}
                  </Link>
                ))}
            </div>
          )}
          <Link href="/whatsapp/numbers" className={buttonClasses("outline", "sm")}>
            <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Numbers
          </Link>
        </div>
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

      <div className="grid h-[calc(100dvh-14rem)] min-h-[28rem] overflow-hidden rounded-lg border bg-card md:grid-cols-[20rem_1fr]">
        {/* Conversation list */}
        <ul className={cn("overflow-y-auto border-r", selected && "hidden md:block")}>
          {conversations.length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">No conversations yet.</li>
          )}
          {conversations.map(({ whatsapp_conversations: conv, whatsapp_numbers: num }) => {
            const active = conv.id === selected?.id;
            return (
              <li key={conv.id}>
                <Link
                  href={qs({ c: conv.id })}
                  className={cn(
                    "block border-b px-4 py-3 text-sm hover:bg-muted/50",
                    active && "bg-muted",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate", conv.unreadCount > 0 ? "font-semibold" : "font-medium")}>
                      {contactName(conv)}
                    </span>
                    <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                      {fmtWhen(conv.lastMessageAt, now)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">{conv.lastMessagePreview}</span>
                    {conv.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-foreground">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!numberFilter && <Badge size="sm" variant="secondary">{numberName(num)}</Badge>}
                    {conv.lastReferral ? <Badge size="sm" variant="violet">Ad</Badge> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

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
                    href={qs({ c: null })}
                    className="mb-1 inline-flex items-center text-xs text-muted-foreground hover:text-foreground md:hidden"
                  >
                    <ArrowLeft className="mr-1 h-3 w-3" /> Conversations
                  </Link>
                  <div className="truncate font-medium">{contactName(selected)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      selected.waId ? `+${selected.waId}` : null,
                      selected.username ? `@${selected.username}` : null,
                      `to ${numberName(numberById.get(selected.numberId) ?? null)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {windowCloses && windowCloses > now && (
                  <Badge variant="success" className="flex-shrink-0">
                    Can reply until {fmtWhen(windowCloses, now)}
                  </Badge>
                )}
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto bg-muted/20 px-4 py-4">
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm",
                        m.direction === "out" ? "bg-brand/15" : "bg-card",
                      )}
                    >
                      {m.referral ? <ReferralNote referral={m.referral as Referral} /> : null}
                      <MessageBody m={m} />
                      <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                        {m.sentByEmail && <span className="mr-1">{m.sentByEmail.split("@")[0]}</span>}
                        <span title={fmtFull(m.sentAt)}>{fmtWhen(m.sentAt, now)}</span>
                        <StatusIcon m={m} />
                      </div>
                      {m.status === "failed" && m.errorMessage && (
                        <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">{m.errorMessage}</p>
                      )}
                    </div>
                  </div>
                ))}
                <WhatsappScrollToEnd marker={messages.at(-1)?.id ?? ""} />
              </div>
              <WhatsappComposer conversationId={selected.id} disabledReason={disabledReason} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
