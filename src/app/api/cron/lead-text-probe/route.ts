// TEMPORARY READ-ONLY DIAGNOSTIC — DELETE AFTER USE. Not in vercel.json.
//
// Step 0 of adding CallRail text conversations to the lead tracker. Answers,
// from the live API, before any ingestion is built:
//   1. which keys exist on a message's sms_thread (KEY NAMES ONLY);
//   2. whether a thread has its own id, and how many conversations hold
//      more than one thread;
//   3. whether notes sit on the thread, and how many threads have one;
//   4. per mapped company, how many conversations are active this month and
//      how many have more than 2 messages (the list preview's cap);
//   5. whether start_date/end_date filter on last_message_at.
//
// Returns COUNTS AND KEY NAMES ONLY: never a customer name, phone number,
// note, message text, tag value other than our own status words, or a
// conversation id. Writes nothing. Access: the CRON_SECRET bearer, or a
// staff session.

import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/leads/admin-auth";
import { fetchWithRetry, LEAD_STATUS_TAGS, resolveTrackerAccountId, tagNames } from "@/lib/leads/callrail-client";
import { drizzleLeadStore } from "@/lib/leads/store";
import { mappedCompanyIds } from "@/lib/leads/sync";
import { firstOfMonthIsoEastern, todayIsoEastern, toIsoDateEastern } from "@/lib/date-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";
/** Full-history fetches across all companies, to stay well inside maxDuration. */
const MAX_DETAIL_FETCHES = 120;
/** Wall-clock limit for the whole probe. */
const BUDGET_MS = 240_000;

function cronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  return !!expected && req.headers.get("authorization") === `Bearer ${expected}`;
}

function headers(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return { Authorization: `Token token="${key}"`, "Content-Type": "application/json" };
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetchWithRetry(url, { headers: headers() }, { maxAttempts: 3 });
  if (!res.ok) throw new Error(`CallRail ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const TRACKED = new Set([...LEAD_STATUS_TAGS, "Opportunity"].map((t) => t.toLowerCase()));

type CompanyReport = {
  companyId: string;
  conversations: number;
  pagesListed: number;
  previewMessagesMax: number;
  lastMessageInWindow: number;
  lastMessageBeforeWindow: number;
  lastMessageMissing: number;
  detailFetched: number;
  moreThan2Messages: number;
  firstMessageBeforeWindow: number;
  conversationsWithMultipleThreadIds: number;
  threadsWithTrackedStatusTag: number;
  error: string | null;
};

export async function GET(req: Request) {
  // CRON_SECRET, or else a staff session. Refuses before reading anything.
  if (!cronAuthorized(req)) {
    const denied = await requireAdminRoute();
    if (denied) return denied;
  }

  const started = Date.now();
  const outOfTime = () => Date.now() - started > BUDGET_MS;
  const from = firstOfMonthIsoEastern();
  const to = todayIsoEastern();

  const { companyRules } = await drizzleLeadStore.loadRoutingRules();
  const companies = mappedCompanyIds(companyRules);
  const accountId = await resolveTrackerAccountId();

  const listKeys = new Set<string>();
  const previewMessageKeys = new Set<string>();
  const detailMessageKeys = new Set<string>();
  const smsThreadKeys = new Set<string>();
  let threadsSeen = 0;
  let threadsWithId = 0;
  let threadsWithNotesKey = 0;
  let threadsWithNonEmptyNotes = 0;
  const notesValueTypes = new Set<string>();
  let detailBudget = MAX_DETAIL_FETCHES;
  let stoppedEarly = false;

  const reports: CompanyReport[] = [];
  for (const companyId of companies) {
    if (outOfTime()) {
      stoppedEarly = true;
      break;
    }
    const r: CompanyReport = {
      companyId,
      conversations: 0,
      pagesListed: 0,
      previewMessagesMax: 0,
      lastMessageInWindow: 0,
      lastMessageBeforeWindow: 0,
      lastMessageMissing: 0,
      detailFetched: 0,
      moreThan2Messages: 0,
      firstMessageBeforeWindow: 0,
      conversationsWithMultipleThreadIds: 0,
      threadsWithTrackedStatusTag: 0,
      error: null,
    };
    try {
      const ids: string[] = [];
      for (let page = 1; ; page++) {
        const url = new URL(`${BASE_URL}/v3/a/${accountId}/text-messages.json`);
        url.searchParams.set("company_id", companyId);
        url.searchParams.set("start_date", from);
        url.searchParams.set("end_date", to);
        url.searchParams.set("page", String(page));
        url.searchParams.set("per_page", "250");
        url.searchParams.set("fields", "last_message_at,recent_messages");
        const body = await getJson(url.toString());
        r.pagesListed += 1;
        const convos = Array.isArray(body.conversations) ? body.conversations : [];
        for (const c of convos) {
          if (!isObj(c)) continue;
          Object.keys(c).forEach((k) => listKeys.add(k));
          r.conversations += 1;
          if (typeof c.id === "string") ids.push(c.id);
          const preview = Array.isArray(c.recent_messages) ? c.recent_messages : [];
          r.previewMessagesMax = Math.max(r.previewMessagesMax, preview.length);
          for (const m of preview) if (isObj(m)) Object.keys(m).forEach((k) => previewMessageKeys.add(k));
          const last = typeof c.last_message_at === "string" ? new Date(c.last_message_at) : null;
          if (!last || Number.isNaN(last.getTime())) r.lastMessageMissing += 1;
          else if (toIsoDateEastern(last) < from) r.lastMessageBeforeWindow += 1;
          else r.lastMessageInWindow += 1;
        }
        const total = typeof body.total_pages === "number" ? body.total_pages : 1;
        if (page >= total || outOfTime()) break;
      }

      for (const id of ids) {
        if (detailBudget <= 0 || outOfTime()) {
          stoppedEarly = stoppedEarly || ids.length > r.detailFetched;
          break;
        }
        detailBudget -= 1;
        const url = new URL(`${BASE_URL}/v3/a/${accountId}/text-messages/${id}.json`);
        url.searchParams.set("fields", "messages");
        const body = await getJson(url.toString());
        r.detailFetched += 1;
        const messages = Array.isArray(body.messages) ? body.messages.filter(isObj) : [];
        if (messages.length > 2) r.moreThan2Messages += 1;
        let earliest: string | null = null;
        const threadIds = new Set<string>();
        const threadsHere = new Map<string, Record<string, unknown>>();
        for (const m of messages) {
          Object.keys(m).forEach((k) => detailMessageKeys.add(k));
          if (typeof m.created_at === "string" && (!earliest || m.created_at < earliest)) earliest = m.created_at;
          const t = m.sms_thread;
          if (!isObj(t)) continue;
          Object.keys(t).forEach((k) => smsThreadKeys.add(k));
          const tid = t.id !== undefined && t.id !== null ? String(t.id) : null;
          if (tid) threadIds.add(tid);
          // One entry per thread (by id when present), so a thread's facts count once.
          threadsHere.set(tid ?? `anon-${threadsHere.size}`, t);
        }
        if (threadIds.size > 1) r.conversationsWithMultipleThreadIds += 1;
        for (const t of threadsHere.values()) {
          threadsSeen += 1;
          if (t.id !== undefined && t.id !== null) threadsWithId += 1;
          if ("notes" in t) {
            threadsWithNotesKey += 1;
            notesValueTypes.add(Array.isArray(t.notes) ? "array" : t.notes === null ? "null" : typeof t.notes);
            const n = t.notes;
            const nonEmpty =
              (typeof n === "string" && n.trim() !== "") ||
              (Array.isArray(n) && n.some((x) => (typeof x === "string" ? x.trim() : isObj(x) ? Object.keys(x).length : 0)));
            if (nonEmpty) threadsWithNonEmptyNotes += 1;
          }
          const tags = tagNames(Array.isArray(t.tags) ? (t.tags as never) : []).map((x) => x.toLowerCase());
          if (tags.some((x) => TRACKED.has(x))) r.threadsWithTrackedStatusTag += 1;
        }
        if (earliest && toIsoDateEastern(new Date(earliest)) < from) r.firstMessageBeforeWindow += 1;
      }
    } catch (err) {
      r.error = err instanceof Error ? err.message.slice(0, 80) : "failed";
    }
    reports.push(r);
  }

  const sum = (k: keyof CompanyReport) => reports.reduce((n, r) => n + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);

  return NextResponse.json(
    {
      window: { from, to },
      mappedCompanies: companies.length,
      companiesProbed: reports.length,
      stoppedEarly,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      keys: {
        conversationListKeys: [...listKeys].sort(),
        previewMessageKeys: [...previewMessageKeys].sort(),
        detailMessageKeys: [...detailMessageKeys].sort(),
        smsThreadKeys: [...smsThreadKeys].sort(),
      },
      threads: {
        seen: threadsSeen,
        withOwnId: threadsWithId,
        withNotesKey: threadsWithNotesKey,
        withNonEmptyNotes: threadsWithNonEmptyNotes,
        notesValueTypes: [...notesValueTypes].sort(),
        conversationsWithMultipleThreadIds: sum("conversationsWithMultipleThreadIds"),
        withTrackedStatusTag: sum("threadsWithTrackedStatusTag"),
      },
      totals: {
        conversations: sum("conversations"),
        detailFetched: sum("detailFetched"),
        moreThan2Messages: sum("moreThan2Messages"),
        // Date filter: if start_date/end_date filter on last_message_at, every
        // listed conversation's last message falls in the window, and some
        // may have their FIRST message before it.
        lastMessageInWindow: sum("lastMessageInWindow"),
        lastMessageBeforeWindow: sum("lastMessageBeforeWindow"),
        lastMessageMissing: sum("lastMessageMissing"),
        firstMessageBeforeWindow: sum("firstMessageBeforeWindow"),
      },
      perCompany: reports,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
