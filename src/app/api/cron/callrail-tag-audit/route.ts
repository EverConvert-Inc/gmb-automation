import { NextResponse } from "next/server";
import { eq, sql, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ppcClients, lsaClients } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

const BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

function authHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return {
    Authorization: `Token token="${key}"`,
    "Content-Type": "application/json",
  };
}

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

async function resolveAccountId(): Promise<string> {
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  const res = await fetch(`${BASE_URL}/v3/a.json`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`accounts fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { accounts?: Array<{ id: string }> };
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible with this API key");
  return first.id;
}

// Every tag the account has ever defined, regardless of whether it's been
// applied to a call recently. This is the authoritative "what tag values
// COULD appear" answer — distinct from what's actually on calls (below).
async function listAllTags(accountId: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 1;
  while (true) {
    const url = `${BASE_URL}/v3/a/${accountId}/tags.json?page=${page}&per_page=250`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`tags fetch failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      tags?: unknown[];
      total_pages?: number;
    };
    for (const t of body.tags ?? []) all.push(t);
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }
  return all;
}

type RawCall = {
  id: string;
  start_time: string;
  tags: Array<{ id: number; name: string } | string> | null;
  source_name?: string | null;
  formatted_tracking_source?: string | null;
};

async function pullRawCalls(
  accountId: string,
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<RawCall[]> {
  const calls: RawCall[] = [];
  let page = 1;
  while (true) {
    const url = new URL(`${BASE_URL}/v3/a/${accountId}/calls.json`);
    url.searchParams.set("company_id", companyId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "250");
    url.searchParams.set("start_date", fromDate);
    url.searchParams.set("end_date", toDate);
    url.searchParams.set(
      "fields",
      "tags,source_name,formatted_tracking_source",
    );
    const res = await fetch(url.toString(), { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`calls fetch failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      calls?: RawCall[];
      total_pages?: number;
    };
    for (const c of body.calls ?? []) calls.push(c);
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }
  return calls;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Temporary read-only audit for the "Ads Conversion Tracker x CallRail"
// report scoping. Answers three questions with real data, not assumptions:
// (1) what tag values actually exist (both defined account-wide and
// actually applied to real calls in the last 30 days), (2) confirms the
// full tags array + tracker/source name are visible per call (they are —
// same fields callrail.ts's pullCallsForCompany already requests, just not
// persisted anywhere past the aggregated signedCases count), (3) whether
// any tracking-source naming distinguishes "Organic" calls, by surfacing
// every distinct source_name/formatted_tracking_source value seen. No DB
// writes. Delete once the report is scoped.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const accountId = await resolveAccountId();

    const to = toIsoDate(new Date());
    const from = toIsoDate(new Date(Date.now() - 30 * 86_400_000));

    const [definedTags, clients] = await Promise.all([
      listAllTags(accountId),
      Promise.all([
        db.query.ppcClients.findMany({
          where: and(
            eq(ppcClients.isActive, true),
            sql`${ppcClients.callrailCompanyId} is not null`,
          ),
          columns: { name: true, callrailCompanyId: true },
        }),
        db.query.lsaClients.findMany({
          where: and(
            eq(lsaClients.isActive, true),
            sql`${lsaClients.callrailCompanyId} is not null`,
          ),
          columns: { name: true, callrailCompanyId: true },
        }),
      ]).then(([p, l]) => [
        ...p.map((c) => ({ ...c, kind: "ppc" as const })),
        ...l.map((c) => ({ ...c, kind: "lsa" as const })),
      ]),
    ]);

    const tagFrequency = new Map<string, number>();
    const sourceNameFrequency = new Map<string, number>();
    const perCompany: Array<{
      kind: string;
      name: string;
      companyId: string;
      totalCalls: number;
      error?: string;
    }> = [];

    for (const client of clients) {
      if (!client.callrailCompanyId) continue;
      try {
        const calls = await pullRawCalls(
          accountId,
          client.callrailCompanyId,
          from,
          to,
        );
        for (const call of calls) {
          const tagNames = (call.tags ?? []).map((t) =>
            typeof t === "string" ? t : t.name,
          );
          if (tagNames.length === 0) {
            tagFrequency.set("(no tags)", (tagFrequency.get("(no tags)") ?? 0) + 1);
          }
          for (const t of tagNames) {
            tagFrequency.set(t, (tagFrequency.get(t) ?? 0) + 1);
          }
          const src =
            call.source_name ?? call.formatted_tracking_source ?? "(none)";
          sourceNameFrequency.set(src, (sourceNameFrequency.get(src) ?? 0) + 1);
        }
        perCompany.push({
          kind: client.kind,
          name: client.name,
          companyId: client.callrailCompanyId,
          totalCalls: calls.length,
        });
      } catch (err) {
        console.error(
          `[callrail-tag-audit] company "${client.name}" (${client.callrailCompanyId}) failed:`,
          err,
        );
        perCompany.push({
          kind: client.kind,
          name: client.name,
          companyId: client.callrailCompanyId,
          totalCalls: 0,
          error: (err as Error).message,
        });
      }
    }

    return NextResponse.json({
      window: { from, to },
      definedTagsAccountWide: definedTags,
      companiesChecked: perCompany,
      tagsActuallyAppliedToCallsInWindow: Object.fromEntries(
        [...tagFrequency.entries()].sort((a, b) => b[1] - a[1]),
      ),
      trackingSourceNamesSeenInWindow: Object.fromEntries(
        [...sourceNameFrequency.entries()].sort((a, b) => b[1] - a[1]),
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[callrail-tag-audit] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
