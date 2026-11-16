import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CircleCheck, ListChecks, ShieldAlert, Sigma } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import {
  AdsDashboardHeader,
  Change,
  fmtConv,
  fmtDay,
  TD,
  TDR,
  TH,
  THEAD,
  THR,
} from "@/components/ads-dashboard-ui";
import { getAdsDashboardClient, getConversionAudit } from "@/lib/queries-ads-dashboard";
import type { AuditedAction, AuditVerdict } from "@/lib/ads-conversion-audit";
import { resolveWindow, type AdsDashboardWindow } from "@/lib/ads-dashboard-compare";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = { title: "Conversion audit" };

const VERDICT: Record<AuditVerdict, { label: string; variant: "red" | "amber" | "green" | "slate" }> = {
  junk_counted: { label: "Likely junk — counting", variant: "red" },
  junk_primary_idle: { label: "Junk risk — primary, idle", variant: "amber" },
  review: { label: "Review", variant: "amber" },
  ok: { label: "Counting", variant: "green" },
  not_counting: { label: "Not counting", variant: "slate" },
};

const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: "Search",
  PERFORMANCE_MAX: "PMax",
  DEMAND_GEN: "Demand Gen",
  DISPLAY: "Display",
  VIDEO: "Video",
  LOCAL_SERVICES: "LSA",
};

const titleCase = (s: string) =>
  s ? s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";

function YesNo({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return value ? <span className="font-medium">Yes</span> : <span className="text-muted-foreground">No</span>;
}

function ActionRow({ a }: { a: AuditedAction }) {
  const v = VERDICT[a.verdict];
  const channels = Object.entries(a.byChannel).sort((x, y) => y[1] - x[1]);
  return (
    <tr className={a.verdict === "junk_counted" ? "bg-red-500/[0.04]" : undefined}>
      <td className={`${TD} align-top`}>
        <div className="font-medium">{a.name || "(unnamed)"}</div>
        <div className="text-[10px] text-muted-foreground">ID {a.id}</div>
      </td>
      <td className={`${TD} align-top`}>
        <Badge variant={v.variant} size="sm">
          {v.label}
        </Badge>
        {a.reasons.length > 0 && (
          <ul className="mt-1 max-w-xs space-y-0.5 text-xs text-muted-foreground">
            {a.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </td>
      <td className={`${TD} align-top text-xs`}>
        {a.listed ? (
          <>
            <div>{titleCase(a.category)}</div>
            <div className="text-muted-foreground">{titleCase(a.type)}</div>
          </>
        ) : (
          <span className="text-muted-foreground">Not listed</span>
        )}
      </td>
      <td className={`${TD} align-top text-xs`}>
        <YesNo value={a.primaryForGoal} />
      </td>
      <td className={`${TD} align-top text-xs`}>
        <YesNo value={a.includeInConversionsMetric} />
      </td>
      <td className={`${TDR} align-top`}>
        <div className={a.conversions > 0 ? "font-semibold" : "text-muted-foreground"}>
          {fmtConv(a.conversions)}
        </div>
        {channels.length > 0 && (
          <div className="text-[10px] font-normal text-muted-foreground">
            {channels.map(([c, n]) => `${CHANNEL_LABEL[c] ?? titleCase(c)} ${fmtConv(n)}`).join(" · ")}
          </div>
        )}
      </td>
      <td className={`${TDR} align-top text-muted-foreground`}>{fmtConv(a.priorConversions)}</td>
      <td className={`${TDR} align-top`}>
        {(a.conversions > 0 || a.priorConversions > 0) && (
          <Change current={a.conversions} prior={a.priorConversions} />
        )}
      </td>
      <td className={`${TDR} align-top text-muted-foreground`}>{fmtConv(a.allConversions)}</td>
    </tr>
  );
}

// The audit itself: three live Google Ads queries, so it is the slow part
// of the page. It renders inside a Suspense boundary and streams in after
// the header, instead of holding the whole navigation until Google answers.
async function AuditBody({ id, w }: { id: string; w: AdsDashboardWindow }) {
  const result = await getConversionAudit(id, { from: w.from, to: w.to }, w.prior);
  if (!result.ok) {
    return (
      <Banner tone="error" title="Google Ads rejected the audit query">
        {result.error}
      </Banner>
    );
  }

  const { actions, summary } = result.audit;
  const junkPct = summary.junkShare === null ? null : Math.round(summary.junkShare * 100);
  const junkActions = actions.filter((a) => a.verdict === "junk_counted");

  return (
    <div className="space-y-6">
      {summary.junkConversions > 0 ? (
        <Banner
          tone="error"
          title={`${fmtConv(summary.junkConversions)} of ${fmtConv(summary.totalConversions)} conversions (${junkPct}%) came from actions that are probably not leads`}
        >
          {junkActions
            .map((a) => `${a.name}: ${fmtConv(a.conversions)}`)
            .join(" · ")}
          . Every “conversions” and “cost per conversion” figure for this account — here, in Google
          Ads and in the keyword and search-term reports — includes them.
        </Banner>
      ) : summary.totalConversions > 0 ? (
        <Banner tone="success" title="No likely-junk action counted in this window">
          {summary.reviewConversions > 0
            ? `${fmtConv(summary.reviewConversions)} conversions came from actions marked for review below.`
            : "Every counted conversion came from an action that looks like a real lead."}
        </Banner>
      ) : (
        <Banner tone="info" title="No conversions recorded in this window" />
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Conversions (as Google counts them)"
          value={fmtConv(summary.totalConversions)}
          sublabel={<Change current={summary.totalConversions} prior={result.priorTotal} />}
          icon={<Sigma className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="From likely-junk actions"
          value={fmtConv(summary.junkConversions)}
          sublabel={
            junkPct === null
              ? "—"
              : `${junkPct}% of conversions · ${summary.junkCountedActions} action${summary.junkCountedActions === 1 ? "" : "s"}`
          }
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={summary.junkConversions > 0 ? "red" : "default"}
        />
        <StatTile
          label="From actions to review"
          value={fmtConv(summary.reviewConversions)}
          sublabel="Counted, needs a human look"
          icon={<ListChecks className="h-4 w-4" />}
          tone={summary.reviewConversions > 0 ? "amber" : "default"}
        />
        <StatTile
          label="From lead actions"
          value={fmtConv(summary.cleanConversions)}
          sublabel="Calls, forms, imported leads"
          icon={<CircleCheck className="h-4 w-4" />}
        />
      </div>

      <SectionCard
        icon={<ListChecks className="h-4 w-4" />}
        title="Conversion actions"
        eyebrow={`${fmtDay(w.from)} – ${fmtDay(w.to)} · live from Google Ads`}
      >
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Action</th>
                <th className={TH}>Verdict</th>
                <th className={TH}>Category / type</th>
                <th className={TH}>Primary</th>
                <th className={TH} title="Google's include_in_conversions_metric flag">
                  “Include in conversions” flag
                </th>
                <th className={THR}>Conversions</th>
                <th className={THR}>Comparison</th>
                <th className={THR}>Change</th>
                <th className={THR}>All conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {actions.map((a) => (
                <ActionRow key={a.id} a={a} />
              ))}
              {actions.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                    This account has no conversion actions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">Conversions</strong> is what each action added to
            Google’s Conversions figure in the window, with the campaign types it came from.{" "}
            <strong className="text-foreground">All conv.</strong> is everything the action recorded,
            counted or not — shown for context only and never used as a conversion number.
          </p>
          <p>
            Verdicts are judged from what an action actually counted, not from its flags: on live
            accounts, actions with the “include in conversions” flag off still counted. An action is
            flagged as likely junk when its category or name describes a tap, visit or engagement
            rather than a lead.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}

function AuditSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading the conversion audit from Google Ads">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg bg-muted/60" />
        ))}
      </div>
      <div className="h-96 rounded-lg bg-muted/40" />
    </div>
  );
}

// Per-client conversion-action audit. Reads Google Ads live: it shows what
// the account is configured to count RIGHT NOW and what each action put
// into the Conversions figure in the window. Nothing here is stored.
export default async function ConversionAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; compare?: string }>;
}) {
  const { id } = await params;
  const client = await getAdsDashboardClient(id);
  if (!client) notFound();
  const w = resolveWindow(await searchParams, {
    from: daysAgoIsoEastern(30),
    to: yesterdayIsoEastern(),
  });
  return (
    <div className="space-y-6">
      <AdsDashboardHeader client={client} tab="conversions" window={w} showSync={false} />
      <Suspense key={`${w.from}|${w.to}|${w.mode}`} fallback={<AuditSkeleton />}>
        <AuditBody id={id} w={w} />
      </Suspense>
    </div>
  );
}
