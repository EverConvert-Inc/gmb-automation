import { NextResponse } from "next/server";
import { and, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthCredentials, ppcClients } from "@/lib/db/schema";
import { decryptString } from "@/lib/crypto";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";
import { enums } from "google-ads-api";
import { getCustomer } from "@/lib/google-ads";
import { formatImpressionShare } from "@/lib/ads-impression-share";

export const runtime = "nodejs";
export const maxDuration = 300;

function checkCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

// Only a real cycle (an object nested inside itself) is replaced. The same
// object appearing twice in different branches is serialized both times —
// treating every repeat as circular is what turned nonPrimaryCounted into
// ["[Circular]"], since its entries are the same objects as
// countedInConversions.
function safeStringify(value: unknown): string {
  const ancestors: object[] = [];
  return JSON.stringify(value, function (this: unknown, _k, v) {
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "object" && v !== null) {
      // `this` is the object holding v: unwind to it, then check the chain.
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
      if (ancestors.includes(v)) return "[Circular]";
      ancestors.push(v);
    }
    return v;
  });
}

// google-ads-api throws gRPC-style objects, not Error instances — same
// handling as the other diagnostics.
function describeError(err: unknown): unknown {
  if (err instanceof Error) {
    const extra: Record<string, unknown> = { message: err.message };
    for (const k of Object.getOwnPropertyNames(err)) {
      if (k === "stack" || k === "message") continue;
      extra[k] = (err as unknown as Record<string, unknown>)[k];
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

type Row = Record<string, Record<string, unknown> | undefined>;

function enumName(name: string, raw: unknown): string {
  if (typeof raw !== "number") return String(raw ?? "");
  const map = (enums as unknown as Record<string, Record<number, string> | undefined>)[name];
  return map?.[raw] ?? String(raw);
}

// Temporary read-only diagnostic for the Ads Dashboard, round 2. Round 1
// (row counts, field availability, conversion-action list) is answered;
// this run settles two remaining data-truth questions against ONE real PPC
// client per call:
//
//   A. Impression-share matrix. Each of five impression-share metrics is
//      queried on its own against keyword_view, campaign and ad_group, so a
//      rejection names exactly one field x resource pair. Round 1 only
//      proved that the five selected TOGETHER on keyword_view are rejected.
//
//   B. Which conversion actions land in metrics.conversions, and why. For
//      every campaign x conversion action with conversions in the window it
//      reports the action's primary_for_goal next to the campaign's goal
//      setup: whether it uses the account's goals or its own, whether the
//      action's category/origin goal is biddable at each level, and whether
//      a custom goal lists the action. That is what explains a non-primary
//      action showing up in metrics.conversions.
//
// Each query runs in its own try/catch so one rejection can't hide the
// rest. Strictly read-only — nothing is written to Google or to the DB.
// Not registered in vercel.json. Delete once the answers are reported.
//
// Usage:
//   /api/cron/ads-dashboard-test?customerId=<digits>[&days=30]
//   /api/cron/ads-dashboard-test?client=<name substring>[&days=30]
const SHARE_FIELDS = [
  "search_impression_share",
  "search_rank_lost_impression_share",
  "search_top_impression_share",
  "search_absolute_top_impression_share",
  "search_budget_lost_impression_share",
] as const;

const SHARE_RESOURCES = [
  { resource: "keyword_view", id: "ad_group_criterion.criterion_id" },
  { resource: "campaign", id: "campaign.id" },
  { resource: "ad_group", id: "ad_group.id" },
] as const;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const clientName = url.searchParams.get("client");
  const customerIdParam = url.searchParams.get("customerId");
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "30") || 30, 1), 90);
  const fromDate = daysAgoIsoEastern(days);
  const toDate = yesterdayIsoEastern();
  if (!clientName && !customerIdParam) {
    return NextResponse.json({ error: "pass ?customerId= or ?client=" }, { status: 400 });
  }

  // Prefer ?customerId= — name matching is ambiguous when one client's name
  // is a substring of another's. Stored ids may or may not carry dashes.
  const client = await db.query.ppcClients.findFirst({
    where: and(
      isNotNull(ppcClients.googleAdsCustomerId),
      isNotNull(ppcClients.googleAdsOauthTokenId),
      customerIdParam
        ? sql`replace(${ppcClients.googleAdsCustomerId}, '-', '') = ${customerIdParam.replace(/-/g, "")}`
        : ilike(ppcClients.name, `%${clientName}%`),
    ),
  });
  if (!client) {
    return NextResponse.json({ error: "No Ads-linked ppc_clients row matched" }, { status: 404 });
  }
  const cred = await db.query.oauthCredentials.findFirst({
    where: eq(oauthCredentials.id, client.googleAdsOauthTokenId!),
  });
  if (!cred) {
    return NextResponse.json({ error: "oauth_credentials row not found" }, { status: 404 });
  }
  const customer = getCustomer(
    decryptString(cred.refreshTokenEncrypted),
    client.googleAdsCustomerId!,
  );
  const dateWhere = `segments.date BETWEEN '${fromDate}' AND '${toDate}'`;

  async function run<T>(fn: () => Promise<T>): Promise<T | { error: unknown }> {
    try {
      return await fn();
    } catch (err) {
      return { error: describeError(err) };
    }
  }
  const q = async (gaql: string) => (await customer.query(gaql)) as Row[];

  // A. One query per field x resource.
  const matrixCells = await Promise.all(
    SHARE_RESOURCES.flatMap(({ resource, id }) =>
      SHARE_FIELDS.map(async (field) => {
        try {
          const rows = await q(
            `SELECT ${id}, metrics.impressions, metrics.${field} FROM ${resource} WHERE ${dateWhere}`,
          );
          const values = rows
            .map((r) => r.metrics?.[field])
            .filter((v): v is number => typeof v === "number");
          return {
            resource,
            field,
            result: "works" as const,
            rows: rows.length,
            rowsWithValue: values.length,
            sampleValues: values.slice(0, 3),
            sampleDisplay: values.slice(0, 3).map((v) => formatImpressionShare(Number(v))),
          };
        } catch (err) {
          const described = describeError(err) as {
            errors?: Array<{ error_code?: unknown; message?: string }>;
          };
          return {
            resource,
            field,
            result: "rejected" as const,
            errorCodes: described.errors?.map((e) => e.error_code) ?? null,
            errorMessages: described.errors?.map((e) => e.message) ?? described,
          };
        }
      }),
    ),
  );
  const matrix: Record<string, Record<string, string>> = {};
  for (const c of matrixCells) {
    (matrix[c.field] ??= {})[c.resource] =
      c.result === "works" ? `works (${c.rowsWithValue}/${c.rows} rows carry a value)` : "REJECTED";
  }

  // The combination each report would actually send, to confirm the fields
  // that pass individually also pass together.
  const combined = await Promise.all(
    SHARE_RESOURCES.map(({ resource, id }) =>
      run(async () => {
        const ok = matrixCells.filter((c) => c.resource === resource && c.result === "works");
        if (ok.length === 0) return { resource, skipped: "no field works" };
        const rows = await q(
          `SELECT ${id}, ${ok.map((c) => `metrics.${c.field}`).join(", ")} FROM ${resource} WHERE ${dateWhere}`,
        );
        return { resource, fields: ok.map((c) => c.field), result: "works", rows: rows.length };
      }),
    ),
  );

  // B. Goal membership.
  const [actions, customerGoals, campaignGoals, goalConfigs, customGoals, byCampaignAction] =
    await Promise.all([
      run(() =>
        q(`
          SELECT conversion_action.id, conversion_action.name, conversion_action.status,
                 conversion_action.type, conversion_action.category, conversion_action.origin,
                 conversion_action.primary_for_goal,
                 conversion_action.include_in_conversions_metric,
                 conversion_action.owner_customer
          FROM conversion_action`),
      ),
      run(() =>
        q(`
          SELECT customer_conversion_goal.category, customer_conversion_goal.origin,
                 customer_conversion_goal.biddable
          FROM customer_conversion_goal`),
      ),
      run(() =>
        q(`
          SELECT campaign.id, campaign_conversion_goal.category,
                 campaign_conversion_goal.origin, campaign_conversion_goal.biddable
          FROM campaign_conversion_goal`),
      ),
      run(() =>
        q(`
          SELECT campaign.id, conversion_goal_campaign_config.goal_config_level,
                 conversion_goal_campaign_config.custom_conversion_goal
          FROM conversion_goal_campaign_config`),
      ),
      run(() =>
        q(`
          SELECT custom_conversion_goal.id, custom_conversion_goal.name,
                 custom_conversion_goal.status, custom_conversion_goal.conversion_actions
          FROM custom_conversion_goal`),
      ),
      run(() =>
        q(`
          SELECT campaign.id, campaign.name, campaign.status,
                 campaign.advertising_channel_type, segments.conversion_action,
                 segments.conversion_action_name, segments.date,
                 metrics.conversions, metrics.all_conversions
          FROM campaign WHERE ${dateWhere}`),
      ),
    ]);

  const isErr = (v: unknown): v is { error: unknown } =>
    !Array.isArray(v) && typeof v === "object" && v !== null && "error" in v;

  type ActionInfo = {
    id: string;
    name: unknown;
    status: string;
    type: string;
    category: string;
    origin: string;
    primaryForGoal: unknown;
    includeInConversionsMetric: unknown;
    ownerCustomer: unknown;
  };
  const actionById = new Map<string, ActionInfo>();
  if (!isErr(actions)) {
    for (const r of actions) {
      const a = r.conversion_action ?? {};
      actionById.set(String(a.id), {
        id: String(a.id),
        name: a.name,
        status: enumName("ConversionActionStatus", a.status),
        type: enumName("ConversionActionType", a.type),
        category: enumName("ConversionActionCategory", a.category),
        origin: enumName("ConversionOrigin", a.origin),
        primaryForGoal: a.primary_for_goal ?? null,
        includeInConversionsMetric: a.include_in_conversions_metric ?? null,
        ownerCustomer: a.owner_customer ?? null,
      });
    }
  }
  const goalKey = (category: unknown, origin: unknown) =>
    `${enumName("ConversionActionCategory", category)}/${enumName("ConversionOrigin", origin)}`;

  const customerBiddable = new Map<string, unknown>();
  if (!isErr(customerGoals)) {
    for (const r of customerGoals) {
      const g = r.customer_conversion_goal ?? {};
      customerBiddable.set(goalKey(g.category, g.origin), g.biddable ?? null);
    }
  }
  const campaignBiddable = new Map<string, unknown>();
  if (!isErr(campaignGoals)) {
    for (const r of campaignGoals) {
      const g = r.campaign_conversion_goal ?? {};
      campaignBiddable.set(`${r.campaign?.id}|${goalKey(g.category, g.origin)}`, g.biddable ?? null);
    }
  }
  const configByCampaign = new Map<string, { level: string; customGoal: string | null }>();
  if (!isErr(goalConfigs)) {
    for (const r of goalConfigs) {
      const c = r.conversion_goal_campaign_config ?? {};
      configByCampaign.set(String(r.campaign?.id), {
        level: enumName("GoalConfigLevel", c.goal_config_level),
        customGoal: (c.custom_conversion_goal as string | undefined) ?? null,
      });
    }
  }
  const customGoalList = isErr(customGoals)
    ? customGoals
    : customGoals.map((r) => {
        const g = r.custom_conversion_goal ?? {};
        return {
          resourceName: `customers/${String(client.googleAdsCustomerId).replace(/-/g, "")}/customConversionGoals/${g.id}`,
          id: String(g.id),
          name: g.name,
          status: enumName("CustomConversionGoalStatus", g.status),
          conversionActionIds: ((g.conversion_actions as string[] | undefined) ?? []).map((n) =>
            n.split("/").pop(),
          ),
        };
      });

  // Every campaign x action that put anything into metrics.conversions.
  type Cell = {
    campaignId: string;
    campaign: unknown;
    campaignStatus: string;
    channel: string;
    actionId: string;
    actionName: unknown;
    conversions: number;
    allConversions: number;
    dates: string[];
  };
  const cells = new Map<string, Cell>();
  if (!isErr(byCampaignAction)) {
    for (const r of byCampaignAction) {
      const conv = Number(r.metrics?.conversions ?? 0);
      const all = Number(r.metrics?.all_conversions ?? 0);
      if (conv === 0 && all === 0) continue;
      const actionId = String(r.segments?.conversion_action ?? "").split("/").pop() ?? "";
      const key = `${r.campaign?.id}|${actionId}`;
      const cell = cells.get(key) ?? {
        campaignId: String(r.campaign?.id),
        campaign: r.campaign?.name,
        campaignStatus: enumName("CampaignStatus", r.campaign?.status),
        channel: enumName("AdvertisingChannelType", r.campaign?.advertising_channel_type),
        actionId,
        actionName: r.segments?.conversion_action_name,
        conversions: 0,
        allConversions: 0,
        dates: [],
      };
      cell.conversions += conv;
      cell.allConversions += all;
      if (conv > 0) cell.dates.push(String(r.segments?.date));
      cells.set(key, cell);
    }
  }
  const explained = Array.from(cells.values())
    .filter((c) => c.conversions > 0)
    .map((c) => {
      const action = actionById.get(c.actionId);
      const config = configByCampaign.get(c.campaignId) ?? null;
      const key = action ? `${action.category}/${action.origin}` : null;
      const customGoal =
        config?.customGoal && Array.isArray(customGoalList)
          ? customGoalList.find((g) => g.resourceName === config.customGoal) ?? null
          : null;
      return {
        campaign: c.campaign,
        campaignId: c.campaignId,
        campaignStatus: c.campaignStatus,
        channel: c.channel,
        actionId: c.actionId,
        actionName: c.actionName,
        conversions: Math.round(c.conversions * 100) / 100,
        allConversions: Math.round(c.allConversions * 100) / 100,
        conversionDates: c.dates.sort(),
        actionInConversionActionList: Boolean(action),
        primaryForGoal: action?.primaryForGoal ?? null,
        includeInConversionsMetric: action?.includeInConversionsMetric ?? null,
        actionGoal: key,
        campaignGoalConfigLevel: config?.level ?? null,
        campaignCustomGoal: config?.customGoal ?? null,
        customGoalListsThisAction: customGoal
          ? customGoal.conversionActionIds.includes(c.actionId)
          : null,
        customerGoalBiddable: key ? (customerBiddable.get(key) ?? null) : null,
        campaignGoalBiddable: key ? (campaignBiddable.get(`${c.campaignId}|${key}`) ?? null) : null,
      };
    })
    .sort((a, b) => Number(a.primaryForGoal === true) - Number(b.primaryForGoal === true));

  return new NextResponse(
    safeStringify({
      client: { name: client.name, customerId: client.googleAdsCustomerId },
      window: { fromDate, toDate, days },
      impressionShareMatrix: matrix,
      impressionShareCells: matrixCells,
      impressionShareCombined: combined,
      conversionsExplained: {
        // Non-primary (or unlisted) actions that still counted come first.
        countedInConversions: explained,
        nonPrimaryCounted: explained.filter((e) => e.primaryForGoal !== true),
        customConversionGoals: customGoalList,
        customerGoals: isErr(customerGoals)
          ? customerGoals
          : Object.fromEntries(customerBiddable.entries()),
        errors: {
          actions: isErr(actions) ? actions.error : null,
          campaignGoals: isErr(campaignGoals) ? campaignGoals.error : null,
          goalConfigs: isErr(goalConfigs) ? goalConfigs.error : null,
          byCampaignAction: isErr(byCampaignAction) ? byCampaignAction.error : null,
        },
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
}
