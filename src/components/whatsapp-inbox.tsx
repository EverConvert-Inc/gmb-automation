"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CheckCheck, Clock, Megaphone, Send, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// The inbox is server-rendered and has no Realtime (the tables are RLS
// deny-all to the anon key), so new messages arrive by re-rendering on a
// timer — only while the tab is visible.
export function WhatsappAutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}

// Clears the unread badge for the open conversation. Re-runs whenever the
// unread count goes up while the thread is open.
export function WhatsappMarkRead({ conversationId, unread }: { conversationId: string; unread: number }) {
  useEffect(() => {
    if (unread <= 0) return;
    fetch(`/api/whatsapp/conversations/${conversationId}/read`, { method: "POST" }).catch(() => {});
  }, [conversationId, unread]);
  return null;
}

// Number filter: a dropdown instead of a row of chips, so 20+ client numbers
// don't push the inbox down the page.
export function WhatsappNumberSelect({
  options,
  value,
}: {
  options: Array<{ id: string; label: string }>;
  value: string | null;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Filter by number"
      value={value ?? ""}
      onChange={(e) => router.push(e.target.value ? `/whatsapp?n=${e.target.value}` : "/whatsapp")}
      className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="">All numbers</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  mediaId: string | null;
  mediaFilename: string | null;
  referral: { source_id?: string; source_type?: string; headline?: string } | null;
  status: string;
  errorMessage: string | null;
  sentByEmail: string | null;
  sentAt: string;
};

// A reply shown the moment it's sent, before Meta and the next server render
// confirm it. Dropped once the server's list contains its id.
type Pending = { key: string; body: string; sentAt: string; serverId: string | null };

const TZ = "America/New_York";

function fmtTime(iso: string, nowIso: string): string {
  const d = new Date(iso);
  const sameDay =
    d.toLocaleDateString("en-US", { timeZone: TZ }) ===
    new Date(nowIso).toLocaleDateString("en-US", { timeZone: TZ });
  return d.toLocaleString("en-US", {
    timeZone: TZ,
    ...(sameDay ? { timeStyle: "short" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  });
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

function Bubble({
  m,
  nowIso,
  pending,
}: {
  m: ThreadMessage;
  nowIso: string;
  pending?: boolean;
}) {
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
          {m.sentByEmail && <span className="mr-0.5">{m.sentByEmail.split("@")[0]}</span>}
          <span title={new Date(m.sentAt).toLocaleString("en-US", { timeZone: TZ })}>{fmtTime(m.sentAt, nowIso)}</span>
          {out && <StatusIcon status={m.status} />}
        </div>
        {m.status === "failed" && m.errorMessage && (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">{m.errorMessage}</p>
        )}
      </div>
    </div>
  );
}

// The open thread plus its composer. A sent reply appears instantly (the
// server round trip — Meta's send API, the insert and a full re-render — runs
// behind it), so sending never feels like waiting.
export function WhatsappThread({
  conversationId,
  messages,
  nowIso,
  disabledReason,
}: {
  conversationId: string;
  messages: ThreadMessage[];
  nowIso: string;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Drop optimistic bubbles the server now has.
  const serverIds = new Set(messages.map((m) => m.id));
  const visiblePending = pending.filter((p) => !p.serverId || !serverIds.has(p.serverId));

  const lastId = messages.at(-1)?.id;
  const pendingCount = visiblePending.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId, pendingCount]);

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
      router.refresh();
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
                text.trim()
                  ? "bg-brand text-brand-foreground hover:bg-brand/90"
                  : "bg-muted text-muted-foreground",
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
