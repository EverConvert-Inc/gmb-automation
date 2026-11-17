// Display helpers and the serialized shapes the inbox passes from server to
// browser. Pure (no DB), so both the server page/API and the client
// components import it.

export const INBOX_TZ = "America/New_York";

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

// Everything the thread pane needs for one conversation. Served by
// GET /api/whatsapp/conversations/[id] so switching chats never re-renders
// the page.
export type ThreadData = {
  id: string;
  name: string;
  subtitle: string;
  unreadCount: number;
  windowClosesAt: string | null;
  disabledReason: string | null;
  messages: ThreadMessage[];
};

export type ConversationItem = {
  id: string;
  name: string;
  preview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  numberName: string;
  isAd: boolean;
};

export function contactName(c: { profileName: string | null; username: string | null; waId: string | null }): string {
  return c.profileName ?? (c.username ? `@${c.username}` : null) ?? (c.waId ? `+${c.waId}` : "Unknown");
}

export function numberName(
  n: { label: string | null; verifiedName: string | null; displayPhoneNumber: string | null } | null | undefined,
): string {
  return n?.label ?? n?.verifiedName ?? n?.displayPhoneNumber ?? "Unknown number";
}

// "10:51 AM" today, "Nov 18" otherwise.
export function fmtListTime(iso: string | null, now: Date): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay =
    d.toLocaleDateString("en-US", { timeZone: INBOX_TZ }) === now.toLocaleDateString("en-US", { timeZone: INBOX_TZ });
  return d.toLocaleString("en-US", {
    timeZone: INBOX_TZ,
    ...(sameDay ? { timeStyle: "short" } : { month: "short", day: "numeric" }),
  });
}

// "Nov 18, 10:51 AM".
export function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    timeZone: INBOX_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
