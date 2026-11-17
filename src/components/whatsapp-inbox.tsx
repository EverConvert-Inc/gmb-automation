"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

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

// Keeps the thread pinned to the newest message when it changes.
export function WhatsappScrollToEnd({ marker }: { marker: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [marker]);
  return <div ref={ref} aria-hidden />;
}

export function WhatsappComposer({
  conversationId,
  disabledReason,
}: {
  conversationId: string;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setText("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (disabledReason) {
    return (
      <div className="border-t bg-muted/40 px-4 py-3 text-xs text-muted-foreground">{disabledReason}</div>
    );
  }

  return (
    <div className="border-t p-3">
      {error && <p className="mb-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={4096}
          placeholder="Type a reply — Enter to send, Shift+Enter for a new line"
          className="min-h-[2.5rem] flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={busy}
        />
        <Button type="button" onClick={send} disabled={busy || !text.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
