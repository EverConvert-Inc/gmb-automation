"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, Megaphone, Send, User, XCircle } from "lucide-react";
import { AdminSelect } from "@/components/leads/admin-select";
import { cn } from "@/lib/utils";
import {
  fmtDateTime,
  fmtListTime,
  INBOX_TZ,
  type ConversationItem,
  type ThreadData,
  type ThreadMessage,
} from "@/lib/whatsapp-display";

const POLL_MS = 10_000;

// The Cloud API never exposes a customer's profile photo (webhooks carry only
// profile.name / username), so every contact gets the same neutral
// "no profile picture" placeholder.
function Avatar({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground",
        size === "lg" ? "h-10 w-10" : "h-9 w-9",
      )}
    >
      <User className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inbox shell: conversation list + open thread.
//
// Switching chats never re-renders the page. The URL is updated with
// history.pushState (Next keeps useSearchParams in sync), and the thread
// comes from GET /api/whatsapp/conversations/[id] — instantly from a cache
// when it was opened or hovered before, refreshed in the background either
// way. The list itself is server data, refreshed by router.refresh() on the
// poll.
// ---------------------------------------------------------------------------

export function WhatsappInbox({
  conversations,
  numberOptions,
  numberFilter,
  initialThread,
  nowIso,
}: {
  conversations: ConversationItem[];
  numberOptions: Array<{ id: string; label: string }>;
  numberFilter: string | null;
  initialThread: ThreadData | null;
  nowIso: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("c");

  const cache = useRef(new Map<string, ThreadData>(initialThread ? [[initialThread.id, initialThread]] : []));
  const inFlight = useRef(new Set<string>());
  const [, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Conversations opened here, so their unread badge clears immediately
  // instead of on the next list refresh.
  const [readLocally, setReadLocally] = useState<Set<string>>(new Set());

  const loadThread = useCallback(async (id: string) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    try {
      const res = await fetch(`/api/whatsapp/conversations/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache.current.set(id, (await res.json()) as ThreadData);
      setVersion((v) => v + 1);
    } catch (err) {
      if (!cache.current.has(id)) setLoadError((err as Error).message);
    } finally {
      inFlight.current.delete(id);
    }
  }, []);

  const href = (convId: string | null) => {
    const p = new URLSearchParams();
    if (numberFilter) p.set("n", numberFilter);
    if (convId) p.set("c", convId);
    const s = p.toString();
    return s ? `/whatsapp?${s}` : "/whatsapp";
  };

  function open(id: string | null) {
    setLoadError(null);
    window.history.pushState(null, "", href(id));
  }

  // Fetch (or refresh) whatever is selected, including after back/forward.
  useEffect(() => {
    if (selectedId) loadThread(selectedId);
  }, [selectedId, loadThread]);

  // Poll: list via a server re-render, the open thread via its API.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      if (selectedId) loadThread(selectedId);
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, selectedId, loadThread]);

  const thread = selectedId ? (cache.current.get(selectedId) ?? null) : null;

  // Clear unread on the server once the open thread shows some.
  const threadUnread = thread?.unreadCount ?? 0;
  useEffect(() => {
    if (!selectedId || threadUnread <= 0) return;
    setReadLocally((prev) => new Set(prev).add(selectedId));
    fetch(`/api/whatsapp/conversations/${selectedId}/read`, { method: "POST" }).catch(() => {});
  }, [selectedId, threadUnread]);

  const now = new Date(nowIso);

  return (
    <div className="grid h-[calc(100dvh-9.5rem)] min-h-[28rem] overflow-hidden rounded-xl border bg-background shadow-sm dark:bg-card dark:shadow-none md:grid-cols-[20rem_1fr]">
      {/* Conversation list */}
      <aside className={cn("flex min-h-0 flex-col border-r", selectedId && "hidden md:flex")}>
        {numberOptions.length > 1 && (
          <div className="border-b p-3">
            <AdminSelect
              aria-label="Filter by number"
              value={numberFilter ?? ""}
              onChange={(e) => router.push(e.target.value ? `/whatsapp?n=${e.target.value}` : "/whatsapp")}
            >
              <option value="">All numbers</option>
              {numberOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </AdminSelect>
          </div>
        )}
        <ul className="flex-1 overflow-y-auto">
          {conversations.length === 0 && <li className="p-4 text-sm text-muted-foreground">No conversations yet.</li>}
          {conversations.map((conv) => {
            const active = conv.id === selectedId;
            const unread = conv.unreadCount > 0 && !readLocally.has(conv.id) && !active;
            return (
              <li key={conv.id}>
                <a
                  href={href(conv.id)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab etc.
                    e.preventDefault();
                    open(conv.id);
                  }}
                  onMouseEnter={() => !cache.current.has(conv.id) && loadThread(conv.id)}
                  onFocus={() => !cache.current.has(conv.id) && loadThread(conv.id)}
                  className={cn(
                    "relative flex gap-3 border-b border-border/60 px-4 py-3 text-sm transition-colors",
                    active ? "bg-brand-muted dark:bg-muted" : "hover:bg-card dark:hover:bg-muted/50",
                  )}
                >
                  {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-brand" />}
                  <Avatar />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate", unread ? "font-semibold" : "font-medium")}>{conv.name}</span>
                      <span
                        className={cn(
                          "flex-shrink-0 text-[11px]",
                          unread ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {fmtListTime(conv.lastMessageAt, now)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>
                        {conv.preview}
                      </span>
                      {unread && (
                        <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-foreground">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {!numberFilter && <span className="truncate">{conv.numberName}</span>}
                      {conv.isAd && (
                        <span className="flex-shrink-0 rounded bg-brand-muted px-1 font-medium text-foreground dark:bg-violet-500/[0.15] dark:text-violet-400">
                          Ad
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Thread */}
      <section className={cn("flex min-h-0 flex-col", !selectedId && "hidden md:flex")}>
        {!selectedId ? (
          <div className="m-auto p-6 text-sm text-muted-foreground">Pick a conversation.</div>
        ) : !thread ? (
          <div className="m-auto p-6 text-sm text-muted-foreground">
            {loadError ? `Couldn't load this conversation: ${loadError}` : "Loading…"}
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => open(null)}
                  aria-label="Back to conversations"
                  className="-ml-1 rounded-md p-1 text-muted-foreground hover:text-foreground md:hidden"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <Avatar size="lg" />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{thread.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{thread.subtitle}</div>
                </div>
              </div>
              {thread.windowClosesAt && new Date(thread.windowClosesAt) > now && (
                <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-brand-muted px-2.5 py-1 text-xs font-medium text-foreground dark:rounded-md dark:bg-green-500/[0.15] dark:px-2 dark:py-0.5 dark:text-green-400">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand dark:hidden" />
                  Can reply until {fmtDateTime(thread.windowClosesAt)}
                </span>
              )}
            </header>
            <WhatsappThread
              conversationId={thread.id}
              messages={thread.messages}
              nowIso={nowIso}
              disabledReason={thread.disabledReason}
              onSent={() => {
                loadThread(thread.id);
                router.refresh();
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread messages + composer
// ---------------------------------------------------------------------------

// A reply shown the moment it's sent, before Meta and the next refresh
// confirm it. Dropped once the thread's messages contain its id.
type Pending = { key: string; body: string; sentAt: string; serverId: string | null };

function fmtTime(iso: string, nowIso: string): string {
  const d = new Date(iso);
  const sameDay =
    d.toLocaleDateString("en-US", { timeZone: INBOX_TZ }) ===
    new Date(nowIso).toLocaleDateString("en-US", { timeZone: INBOX_TZ });
  return sameDay ? d.toLocaleString("en-US", { timeZone: INBOX_TZ, timeStyle: "short" }) : fmtDateTime(d);
}

function StatusIcon({ status }: { status: string }) {
  const cls = "h-3.5 w-3.5";
  switch (status) {
    case "read":
      return <CheckCheck className={cn(cls, "text-sky-800 dark:text-sky-500")} aria-label="Read" />;
    case "delivered":
      return <CheckCheck className={cls} aria-label="Delivered" />;
    case "sent":
      return <Check className={cls} aria-label="Sent" />;
    case "failed":
      return <XCircle className={cn(cls, "text-red-700 dark:text-red-400")} aria-label="Failed" />;
    default:
      return <Clock className={cls} aria-label="Sending" />;
  }
}

function MessageBody({ m }: { m: ThreadMessage }) {
  const src = m.mediaId ? `/api/whatsapp/media/${encodeURIComponent(m.mediaId)}` : null;
  return (
    <>
      {src && m.type === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy, not optimisable
        <img src={src} alt={m.body ?? "Photo"} className="mb-1 max-h-72 rounded-md" loading="lazy" />
      )}
      {src && m.type === "sticker" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Sticker" className="h-28 w-28" loading="lazy" />
      )}
      {src && m.type === "audio" && <audio controls preload="none" src={src} className="max-w-full" />}
      {src && m.type === "video" && <video controls preload="none" src={src} className="mb-1 max-h-72 rounded-md" />}
      {src && m.type === "document" && (
        <a href={src} target="_blank" rel="noreferrer" className="mb-1 block underline">
          {m.mediaFilename ?? "Document"}
        </a>
      )}
      {m.body ? (
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
      ) : (
        !src && <p className="italic opacity-70">[{m.type}]</p>
      )}
    </>
  );
}

// Light: white inbound bubbles on a soft grey thread, solid EverConvert green
// for our replies. Dark: unchanged from the original (card / brand tint).
const BUBBLE_IN = "border border-border bg-background dark:border-transparent dark:bg-card";
const BUBBLE_OUT = "bg-brand text-brand-foreground dark:bg-brand/15 dark:text-foreground";
const META_OUT = "text-brand-foreground/70 dark:text-muted-foreground";

function Bubble({ m, nowIso, pending }: { m: ThreadMessage; nowIso: string; pending?: boolean }) {
  const out = m.direction === "out";
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
          out ? cn(BUBBLE_OUT, "rounded-br-md") : cn(BUBBLE_IN, "rounded-bl-md"),
          pending && "opacity-80",
        )}
      >
        {m.referral && (
          <div className="mb-1.5 flex items-center gap-1 text-[11px] opacity-75">
            <Megaphone className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              From {m.referral.source_type === "ad" ? "ad" : (m.referral.source_type ?? "referral")}
              {m.referral.headline ? `: ${m.referral.headline}` : ""}
            </span>
          </div>
        )}
        <MessageBody m={m} />
        <div
          className={cn(
            "mt-0.5 flex items-center justify-end gap-1 text-[10px]",
            out ? META_OUT : "text-muted-foreground",
          )}
        >
          <span title={fmtDateTime(m.sentAt)}>{fmtTime(m.sentAt, nowIso)}</span>
          {out && <StatusIcon status={m.status} />}
        </div>
        {m.status === "failed" && m.errorMessage && (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">{m.errorMessage}</p>
        )}
      </div>
    </div>
  );
}

// A sent reply appears instantly; Meta's send API, the insert and the
// refresh all run behind it.
function WhatsappThread({
  conversationId,
  messages,
  nowIso,
  disabledReason,
  onSent,
}: {
  conversationId: string;
  messages: ThreadMessage[];
  nowIso: string;
  disabledReason: string | null;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const serverIds = new Set(messages.map((m) => m.id));
  const visiblePending = pending.filter((p) => !p.serverId || !serverIds.has(p.serverId));

  const lastId = messages.at(-1)?.id;
  const pendingCount = visiblePending.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conversationId, lastId, pendingCount]);

  // A different conversation starts clean.
  useEffect(() => {
    setPending([]);
    setError(null);
    setText("");
  }, [conversationId]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    const key = `p${Date.now()}${Math.random()}`;
    setPending((prev) => [...prev, { key, body, sentAt: new Date().toISOString(), serverId: null }]);
    setText("");
    setError(null);
    inputRef.current?.focus();
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; id?: string | null };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPending((prev) => prev.map((p) => (p.key === key ? { ...p, serverId: json.id ?? key } : p)));
      onSent();
    } catch (err) {
      // Not sent: take the bubble back and return the text to the box.
      setPending((prev) => prev.filter((p) => p.key !== key));
      setText((cur) => cur || body);
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="flex-1 space-y-1.5 overflow-y-auto bg-card px-4 py-4 dark:bg-muted/20">
        {messages.map((m) => (
          <Bubble key={m.id} m={m} nowIso={nowIso} />
        ))}
        {visiblePending.map((p) => (
          <Bubble
            key={p.key}
            pending
            nowIso={nowIso}
            m={{
              id: p.key,
              direction: "out",
              type: "text",
              body: p.body,
              mediaId: null,
              mediaFilename: null,
              referral: null,
              status: p.serverId ? "sent" : "sending",
              errorMessage: null,
              sentByEmail: null,
              sentAt: p.sentAt,
            }}
          />
        ))}
        <div ref={endRef} aria-hidden />
      </div>

      {disabledReason ? (
        <div className="border-t bg-background px-4 py-3 text-xs text-muted-foreground dark:bg-muted/40">
          {disabledReason}
        </div>
      ) : (
        <div className="border-t bg-background p-3 dark:bg-transparent">
          {error && (
            <p className="mb-2 flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5" /> Not sent: {error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              aria-label="Reply"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              maxLength={4096}
              placeholder="Message"
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-2xl border bg-card px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:rounded-md dark:bg-background"
            />
            <button
              type="button"
              onClick={send}
              aria-label="Send"
              className={cn(
                "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                text.trim() ? "bg-brand text-brand-foreground hover:bg-brand/90" : "bg-muted text-muted-foreground",
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
