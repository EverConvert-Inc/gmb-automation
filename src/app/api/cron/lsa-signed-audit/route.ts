import { NextResponse } from "next/server";
import { and, eq, gte, ilike, lte, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  callSignedEvents,
  lsaCallrailTagCategories,
  lsaClients,
  lsaLeadsDaily,
  ppcClients,
  textConversationSignedEvents,
} from "@/lib/db/schema";
import {
  matchesAnyFilter,
  pullCallsForCompany,
  pullTextMessagesForCompany,
} from "@/lib/callrail";
import { toIsoDateEastern } from "@/lib/date-utils";
import {
  attributeSignedCalls,
  earliestRealMessage,
  phoneKey,
} from "@/lib/lsa-signed-audit";

export const runtime = "nodejs";
export const maxDuration = 300;

// TEMPORARY DIAGNOSTIC — read-only. Lists every item counted in an LSA
// client's Signed total for a range, using the sync's own counting
// (pullCallsForCompany / pullTextMessagesForCompany, plus the true-sign-date
// placement mirrored in src/lib/lsa-signed-audit.ts), and flags anything not
// on an expected list. Built to resolve Panchenko Law's Oct 1-16 2026
// report (11 Signed) vs CallRail (10). No DB writes, no sync calls.
// CRON_SECRET-gated and deliberately NOT in vercel.json. Delete this route
// and src/lib/lsa-signed-audit.ts (+ test) once the question is answered.
//
//   GET /api/cron/lsa-signed-audit?client=panchenko&from=2026-10-01&to=2026-10-16
//   Authorization: Bearer $CRON_SECRET
//
// Costs CallRail API calls only (one per counted call/text plus the list
// pulls) — no DataForSEO or Google Ads spend.

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// What CallRail showed for Panchenko, Oct 1-16 2026 (Eastern dates).
const EXPECTED: Array<{ type: "call" | "text"; date: string; time: string; phone: string }> = [
  { type: "call", date: "2026-10-10", time: "1:29pm", phone: "980-497-1221" },
  { type: "call", date: "2026-10-09", time: "5:34pm", phone: "919-618-8146" },
  { type: "call", date: "2026-10-08", time: "10:40am", phone: "828-773-2415" },
  { type: "call", date: "2026-10-07", time: "5:16pm", phone: "984-392-7299" },
  { type: "call", date: "2026-10-05", time: "4:38pm", phone: "704-490-8012" },
  { type: "call", date: "2026-10-04", time: "5:46pm", phone: "704-433-1719" },
  { type: "call", date: "2026-10-02", time: "6:06pm", phone: "919-797-6570" },
  { type: "text", date: "2026-10-09", time: "1:06pm", phone: "916-668-2310" },
  { type: "text", date: "2026-10-05", time: "8:44am", phone: "253-465-8436" },
  { type: "text", date: "2026-10-02", time: "4:37pm", phone: "973-354-3413" },
];

// --- Minimal CallRail fetch, mirroring src/lib/callrail.ts's auth/account
// resolution (same duplication text-message-audit and pmax-match-audit use)
// for the per-item detail lookups callrail.ts doesn't expose.
const CALLRAIL_BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

function callrailAuthHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return { Authorization: `Token token="${key}"`, "Content-Type": "application/json" };
}

let cachedAccountId: string | null = null;
async function resolveCallrailAccountId(): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  const res = await fetch(`${CALLRAIL_BASE_URL}/v3/a.json`, { headers: callrailAuthHeaders() });
  if (!res.ok) throw new Error(`CallRail accounts fetch failed: ${res.status}`);
  const body = (await res.json()) as { accounts?: Array<{ id: string }> };
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible with this API key");
  cachedAccountId = first.id;
  return first.id;
}

type Tag = { name: string } | string;
const tagName = (t: Tag) => (typeof t === "string" ? t : t.name);

type CallDetail = {
  id: string;
  start_time: string;
  customer_phone_number?: string | null;
  source_name?: string | null;
  formatted_tracking_source?: string | null;
  tags?: Tag[] | null;
};

type ConversationDetail = {
  id: string;
  customer_phone_number?: string | null;
  formatted_customer_phone_number?: string | null;
  tracker_name?: string | null;
  messages?: Array<{ created_at: string; sms_thread?: { tags?: Tag[] | null } | null }> | null;
};

async function getJson<T>(path: string, fields: string): Promise<T | null> {
  const accountId = await resolveCallrailAccountId();
  const url = new URL(`${CALLRAIL_BASE_URL}/v3/a/${accountId}/${path}`);
  url.searchParams.set("fields", fields);
  const res = await fetch(url.toString(), { headers: callrailAuthHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CallRail ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const easternFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
});
function fmtEastern(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? null : easternFmt.format(d);
}

type Row = {
  type: "call" | "text";
  id: string;
  callerPhone: string | null;
  actualAtEastern: string | null;
  actualDateEastern: string | null;
  taggedSignedAtEastern: string | null;
  countedOn: string;
  inReportRange: boolean;
  countsTowardSigned: boolean;
  path: string;
  trackerName: string | null;
  matchedNameFilter: string | null;
  currentTags: string[];
  matchesExpected: string | null;
  flags: string[];
};

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const clientQuery = url.searchParams.get("client") ?? "panchenko";
  const fromDate = url.searchParams.get("from") ?? "2026-10-01";
  const toDate = url.searchParams.get("to") ?? "2026-10-16";

  try {
    const matches = await db.query.lsaClients.findMany({
      where: or(
        eq(lsaClients.slug, clientQuery),
        ilike(lsaClients.name, `%${clientQuery}%`),
      ),
    });
    if (matches.length !== 1) {
      return NextResponse.json(
        {
          error: `expected exactly one lsa_client for "${clientQuery}", found ${matches.length}`,
          matches: matches.map((m) => ({ id: m.id, name: m.name, slug: m.slug })),
        },
        { status: 400 },
      );
    }
    const client = matches[0];
    if (!client.callrailCompanyId) {
      return NextResponse.json({ error: "client has no callrail_company_id" }, { status: 400 });
    }
    const companyId = client.callrailCompanyId;

    // Same arguments fetchAndBucketLsaCalls (lsa-sync.ts) passes.
    const tagCategories = (
      await db.query.lsaCallrailTagCategories.findMany({
        where: eq(lsaCallrailTagCategories.lsaClientId, client.id),
      })
    ).map((c) => ({ ...c, rollup: c.rollup as "real" | "junk" }));
    const hasMatchingPpcClient = !!(await db.query.ppcClients.findFirst({
      where: eq(ppcClients.callrailCompanyId, companyId),
      columns: { id: true },
    }));
    const gmbNameFilters =
      hasMatchingPpcClient || client.gmbCallrailNameFilters.length === 0
        ? undefined
        : client.gmbCallrailNameFilters;
    const pullCalls = (from: string, to: string) =>
      pullCallsForCompany(
        companyId,
        from,
        to,
        client.signedCaseNameFilters,
        tagCategories,
        gmbNameFilters,
        "LSA",
      );

    const callRows = await pullCalls(fromDate, toDate);
    const candidates = callRows.flatMap((r) => r.signedRealCandidates);
    const events = await db.query.callSignedEvents.findMany({
      where: eq(callSignedEvents.lsaClientId, client.id),
    });
    const attributions = attributeSignedCalls(
      candidates,
      events.map((e) => ({
        callId: e.callrailCallId,
        signedAt: e.signedAt,
        isRollupReal: e.isRollupReal,
        channel: e.channel,
      })),
      fromDate,
      toDate,
    );
    const eventByCallId = new Map(events.map((e) => [e.callrailCallId, e]));

    // For moved-in rows whose call came from outside the range: is that call
    // still real on its own date today? (Stale rows still count — see the
    // pure module — but they are the prime suspects.)
    const stillRealByDate = new Map<string, Set<string>>();
    async function isStillReal(callId: string, originDate: string): Promise<boolean> {
      if (originDate >= fromDate && originDate <= toDate) {
        return candidates.some((c) => c.callId === callId);
      }
      let ids = stillRealByDate.get(originDate);
      if (!ids) {
        const rows = await pullCalls(originDate, originDate);
        ids = new Set(rows.flatMap((r) => r.signedRealCandidates.map((c) => c.callId)));
        stillRealByDate.set(originDate, ids);
      }
      return ids.has(callId);
    }

    const filtersLower = client.signedCaseNameFilters.map((f) => f.trim().toLowerCase()).filter(Boolean);
    function matchedFilter(trackerName: string): string | null {
      const lower = trackerName.toLowerCase();
      return filtersLower.find((f) => matchesAnyFilter(lower, [f])) ?? null;
    }

    const rows: Row[] = [];
    const seenCallCounts = new Map<string, number>();
    for (const a of attributions) {
      seenCallCounts.set(a.callId, (seenCallCounts.get(a.callId) ?? 0) + 1);
    }

    for (const a of attributions) {
      const detail = await getJson<CallDetail>(
        `calls/${a.callId}.json`,
        "tags,source_name,formatted_tracking_source,customer_phone_number",
      );
      const flags: string[] = [];
      const trackerName = detail?.source_name ?? detail?.formatted_tracking_source ?? null;
      const originDate = a.originDate ?? detail?.start_time?.slice(0, 10) ?? null;
      if (!detail) flags.push("call not found in CallRail (deleted/purged)");
      if (a.path === "moved-in") {
        flags.push(`moved from its own date ${originDate ?? "?"} to tagged date ${a.countedOn}`);
        if (originDate && !(await isStillReal(a.callId, originDate))) {
          flags.push("STALE: call no longer resolves real in CallRail, but its call_signed_events row still counts it");
        }
      }
      if ((seenCallCounts.get(a.callId) ?? 0) > 1) flags.push("DOUBLE-COUNTED: same call lands twice");
      if (!a.countsTowardSigned) flags.push("GMB channel — not counted in signed_cases");
      const actualDate = detail ? toIsoDateEastern(new Date(detail.start_time)) : null;
      if (detail && originDate && actualDate !== originDate) {
        flags.push(`CallRail-local date ${originDate} differs from Eastern date ${actualDate}`);
      }
      rows.push({
        type: "call",
        id: a.callId,
        callerPhone: detail?.customer_phone_number ?? null,
        actualAtEastern: fmtEastern(detail?.start_time),
        actualDateEastern: actualDate,
        taggedSignedAtEastern: fmtEastern(eventByCallId.get(a.callId)?.signedAt),
        countedOn: a.countedOn,
        inReportRange: a.countedOn >= fromDate && a.countedOn <= toDate,
        countsTowardSigned: a.countsTowardSigned,
        path: a.path,
        trackerName,
        matchedNameFilter: trackerName ? matchedFilter(trackerName) : null,
        currentTags: (detail?.tags ?? []).map(tagName),
        matchesExpected: null,
        flags,
      });
    }

    // Texts — the sync's own pull decides which conversations are real; the
    // earliest-real-message date is recomputed here (same rule) because the
    // sync only returns per-day totals, then cross-checked against them.
    const texts = await pullTextMessagesForCompany(
      companyId,
      fromDate,
      toDate,
      client.signedCaseNameFilters,
      tagCategories,
    );
    const textEvents = await db.query.textConversationSignedEvents.findMany({
      where: eq(textConversationSignedEvents.lsaClientId, client.id),
    });
    const textEventById = new Map(textEvents.map((e) => [e.callrailConversationId, e]));
    const recomputedTextsByDay = new Map<string, number>();
    for (const convo of texts.conversationRollups.filter((c) => c.rollup === "real")) {
      const detail = await getJson<ConversationDetail>(
        `text-messages/${convo.conversationId}.json`,
        "messages,tracker_name",
      );
      const messages = (detail?.messages ?? []).map((m) => ({
        created_at: m.created_at,
        tags: (m.sms_thread?.tags ?? []).map(tagName),
      }));
      const earliest = earliestRealMessage(messages, tagCategories);
      if (!earliest) continue;
      recomputedTextsByDay.set(earliest.date, (recomputedTextsByDay.get(earliest.date) ?? 0) + 1);
      const firstMessageAt = messages.map((m) => m.created_at).sort()[0];
      const flags: string[] = [];
      if (firstMessageAt && firstMessageAt.slice(0, 10) !== earliest.date) {
        flags.push(`thread started ${fmtEastern(firstMessageAt)}; counted on its first Signed message's date instead`);
      }
      const trackerName = detail?.tracker_name ?? null;
      const textSigned = textEventById.get(convo.conversationId);
      rows.push({
        type: "text",
        id: convo.conversationId,
        callerPhone: detail?.customer_phone_number ?? detail?.formatted_customer_phone_number ?? null,
        actualAtEastern: fmtEastern(earliest.createdAt),
        actualDateEastern: toIsoDateEastern(new Date(earliest.createdAt)),
        taggedSignedAtEastern: textSigned
          ? fmtEastern(textSigned.signedAt)
          : null,
        countedOn: earliest.date,
        inReportRange: earliest.date >= fromDate && earliest.date <= toDate,
        countsTowardSigned: true,
        path: "text",
        trackerName,
        matchedNameFilter: trackerName ? matchedFilter(trackerName) : null,
        currentTags: [...new Set(messages.flatMap((m) => m.tags))],
        matchesExpected: null,
        flags,
      });
    }
    const syncTextsByDay = new Map(texts.dailyRollups.map((r) => [r.date, r.real]));
    const textCrossCheck = [...new Set([...syncTextsByDay.keys(), ...recomputedTextsByDay.keys()])]
      .filter((d) => (syncTextsByDay.get(d) ?? 0) !== (recomputedTextsByDay.get(d) ?? 0))
      .map((d) => ({ date: d, sync: syncTextsByDay.get(d) ?? 0, recomputed: recomputedTextsByDay.get(d) ?? 0 }));

    // Expected-list match: type + phone + Eastern date of the actual call/text.
    const unmatchedExpected = EXPECTED.filter((exp) => {
      const hit = rows.find(
        (r) =>
          !r.matchesExpected &&
          r.type === exp.type &&
          phoneKey(r.callerPhone) === phoneKey(exp.phone) &&
          r.actualDateEastern === exp.date,
      );
      if (hit) hit.matchesExpected = `${exp.date} ${exp.time} ${exp.phone}`;
      return !hit;
    });
    for (const r of rows) {
      if (r.inReportRange && r.countsTowardSigned && !r.matchesExpected) {
        r.flags.unshift("NOT IN CALLRAIL'S 10");
      }
    }

    // Stored vs recomputed, per day.
    const stored = await db
      .select({ date: lsaLeadsDaily.date, signedCases: lsaLeadsDaily.signedCases, ingestedAt: lsaLeadsDaily.ingestedAt })
      .from(lsaLeadsDaily)
      .where(and(eq(lsaLeadsDaily.lsaClientId, client.id), gte(lsaLeadsDaily.date, fromDate), lte(lsaLeadsDaily.date, toDate)));
    const counted = rows.filter((r) => r.inReportRange && r.countsTowardSigned);
    const recomputedByDay = new Map<string, number>();
    for (const r of counted) recomputedByDay.set(r.countedOn, (recomputedByDay.get(r.countedOn) ?? 0) + 1);
    const storedByDay = new Map(stored.map((s) => [s.date, s]));
    const perDay = [...new Set([...storedByDay.keys(), ...recomputedByDay.keys()])]
      .sort()
      .map((date) => ({
        date,
        stored: storedByDay.get(date)?.signedCases ?? 0,
        recomputedNow: recomputedByDay.get(date) ?? 0,
        storedIngestedAt: storedByDay.get(date)?.ingestedAt ?? null,
      }))
      .filter((d) => d.stored !== 0 || d.recomputedNow !== 0);

    rows.sort((a, b) => a.countedOn.localeCompare(b.countedOn) || a.type.localeCompare(b.type));

    return NextResponse.json({
      client: { id: client.id, name: client.name, callrailCompanyId: companyId },
      range: { fromDate, toDate },
      config: {
        signedCaseNameFilters: client.signedCaseNameFilters,
        gmbNameFilters: gmbNameFilters ?? null,
        realCategories: tagCategories.filter((c) => c.rollup === "real").map((c) => c.callrailTagName),
        junkCategories: tagCategories.filter((c) => c.rollup === "junk").map((c) => c.callrailTagName),
      },
      totals: {
        storedSignedCases: stored.reduce((s, r) => s + r.signedCases, 0),
        recomputedNow: counted.length,
        expectedFromCallrail: EXPECTED.length,
      },
      notInCallrailList: counted.filter((r) => !r.matchesExpected),
      expectedButNotCounted: unmatchedExpected,
      perDay,
      textCrossCheckMismatches: textCrossCheck,
      rows,
      notes: [
        "taggedSignedAtEastern for calls is call_signed_events.signed_at (webhook receipt time); null means no webhook row.",
        "taggedSignedAtEastern for texts is text_conversation_signed_events.signed_at, recorded only when a thread flips to Signed after it was first seen — null is normal.",
        "perDay 'stored' is what the report sums; a day where stored != recomputedNow was last written before a tag change and hasn't been re-synced.",
      ],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
