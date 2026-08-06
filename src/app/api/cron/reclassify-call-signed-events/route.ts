import { NextResponse } from "next/server";
import { and, isNotNull, isNull, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { callSignedEvents } from "@/lib/db/schema";
import { getCallStartDate } from "@/lib/callrail";
import { recomputeLsaCallrailDay } from "@/lib/lsa-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Same safe-stringify/describeError pattern as pmax-match-audit/
// text-message-audit.
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}

function describeError(err: unknown): unknown {
  if (err instanceof Error) {
    const extra: Record<string, unknown> = { message: err.message };
    for (const key of Object.getOwnPropertyNames(err)) {
      if (key === "stack" || key === "message") continue;
      extra[key] = (err as unknown as Record<string, unknown>)[key];
    }
    try {
      return JSON.parse(safeStringify(extra));
    } catch {
      return { message: err.message };
    }
  }
  try {
    return JSON.parse(safeStringify(err));
  } catch {
    return { raw: String(err) };
  }
}

// Temporary diagnostic/remediation route — server-side equivalent of
// scripts/reclassify-call-signed-events.ts for an operator who can't run
// tsx locally. Finds call_signed_events rows with a valid lsa_client_id
// but is_signed_case still NULL (never reclassified — see the root-cause
// writeup: applySignedDateCorrections only persists classification as a
// side effect of a sync that fetches the call's ORIGIN date fresh, and
// every regular sync has a fixed lookback window that a sufficiently old
// origin date ages out of). For each eligible row, looks up the call's
// real origin date directly from CallRail (nothing local persists it —
// only signed_at, the redirect TARGET, is stored), then calls
// recomputeLsaCallrailDay for that exact date with no window limit. That
// single call also fixes the target date automatically via
// applyTrueSignDateCorrections' existing recursion.
//
// Defaults to a dry run (looks up + reports, no writes) — pass
// ?apply=true to actually trigger the recompute. Defaults to processing
// at most 20 rows per invocation (?limit=N to change) so a large backlog
// can be worked through in batches without risking the function timeout;
// re-curl to continue. Pass ?callId=CAL_XXX to process (or dry-run) one
// specific call only, ignoring limit — use this FIRST to sanity-check a
// known call (e.g. 1Charlotte's) before running the batch.
//
// Usage:
//   GET /api/cron/reclassify-call-signed-events                        (dry run, up to 20)
//   GET /api/cron/reclassify-call-signed-events?apply=true              (writes, up to 20)
//   GET /api/cron/reclassify-call-signed-events?callId=CAL_XXX          (dry run, this call only)
//   GET /api/cron/reclassify-call-signed-events?callId=CAL_XXX&apply=true
//   GET /api/cron/reclassify-call-signed-events?apply=true&limit=50
//
// Delete once the backlog is cleared and confirmed correct.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "true";
  const callId = url.searchParams.get("callId");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 20;
  if (limitParam && (!Number.isFinite(limit) || limit <= 0)) {
    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  try {
    const eligible = await db.query.callSignedEvents.findMany({
      where: callId
        ? and(
            eq(callSignedEvents.callrailCallId, callId),
            isNotNull(callSignedEvents.lsaClientId),
            isNull(callSignedEvents.isSignedCase),
          )
        : and(
            isNotNull(callSignedEvents.lsaClientId),
            isNull(callSignedEvents.isSignedCase),
          ),
    });

    if (callId && eligible.length === 0) {
      // Distinguish "not eligible" from "doesn't exist" / "already fine"
      // rather than silently reporting an empty batch for a call the
      // operator explicitly asked about.
      const anyRow = await db.query.callSignedEvents.findFirst({
        where: eq(callSignedEvents.callrailCallId, callId),
      });
      return NextResponse.json({
        dryRun: !apply,
        callId,
        totalEligible: 0,
        results: [],
        note: !anyRow
          ? `No call_signed_events row exists for ${callId}`
          : anyRow.lsaClientId === null
            ? `Row exists but lsa_client_id is still NULL — run the lsa_client_id backfill first`
            : `Row exists and is already classified (is_signed_case=${anyRow.isSignedCase}) — nothing to reclassify`,
      });
    }

    const batch = callId ? eligible : eligible.slice(0, limit);

    const results: Array<{
      callId: string;
      lsaClientId: string;
      targetDate: string;
      originDate: string | null;
      action: "recomputed" | "would-recompute" | "skipped-not-found-on-callrail" | "failed";
      error?: unknown;
    }> = [];

    for (const row of batch) {
      const lsaClientId = row.lsaClientId as string; // guaranteed by isNotNull filter
      const targetDate = row.signedAt.toISOString().slice(0, 10);

      let originDate: string | null;
      try {
        originDate = await getCallStartDate(row.callrailCallId);
      } catch (err) {
        results.push({
          callId: row.callrailCallId,
          lsaClientId,
          targetDate,
          originDate: null,
          action: "failed",
          error: describeError(err),
        });
        continue;
      }

      if (!originDate) {
        results.push({
          callId: row.callrailCallId,
          lsaClientId,
          targetDate,
          originDate: null,
          action: "skipped-not-found-on-callrail",
        });
        continue;
      }

      if (!apply) {
        results.push({
          callId: row.callrailCallId,
          lsaClientId,
          targetDate,
          originDate,
          action: "would-recompute",
        });
        continue;
      }

      try {
        await recomputeLsaCallrailDay(lsaClientId, originDate);
        results.push({
          callId: row.callrailCallId,
          lsaClientId,
          targetDate,
          originDate,
          action: "recomputed",
        });
      } catch (err) {
        results.push({
          callId: row.callrailCallId,
          lsaClientId,
          targetDate,
          originDate,
          action: "failed",
          error: describeError(err),
        });
      }
    }

    return NextResponse.json({
      dryRun: !apply,
      totalEligible: eligible.length,
      processedThisRun: results.length,
      remaining: eligible.length - results.length,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 500 });
  }
}
