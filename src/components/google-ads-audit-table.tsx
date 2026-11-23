"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignSettings } from "@/lib/queries-ads-dashboard";
import type { CampaignVerdict, ComplianceSummary } from "@/lib/ads-standards";
import { enumLabel, money0 } from "@/lib/google-ads-format";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2";
const COLS = 11;

function fmtValue(v: string | boolean): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return enumLabel(v);
}

function NetworkPills({ n }: { n: CampaignSettings["networks"] }) {
  const items: [string, boolean][] = [
    ["Search", n.googleSearch],
    ["Partners", n.searchPartners],
    ["Display", n.display],
    ["YouTube", n.youtube],
  ];
  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map(([label, on]) => (
        <span
          key={label}
          className={cn(
            "rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide",
            on ? "bg-foreground/10 text-foreground" : "text-muted-foreground/40 line-through",
          )}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const enabled = status === "ENABLED";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground",
      )}
    >
      {enumLabel(status)}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: CampaignVerdict["verdict"] }) {
  const map = {
    passed: ["bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", "Pass"],
    error: ["bg-red-500/10 text-red-700 dark:text-red-400", "Error"],
    unmatched: ["bg-muted text-muted-foreground", "Unmatched"],
  } as const;
  const [cls, label] = map[verdict];
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", cls)}>{label}</span>;
}

type Breakdown =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "done"; campaigns: CampaignSettings[]; verdicts: CampaignVerdict[]; summary: ComplianceSummary };

export function GoogleAdsAuditTable({ accounts }: { accounts: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openFailures, setOpenFailures] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Record<string, Breakdown>>({});

  async function toggle(id: string) {
    const willOpen = !open.has(id);
    setOpen((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(id);
      else next.delete(id);
      return next;
    });
    if (!willOpen || data[id]) return;
    setData((p) => ({ ...p, [id]: { state: "loading" } }));
    try {
      const res = await fetch(`/api/ads/audit?clientId=${encodeURIComponent(id)}`);
      const json = (await res.json()) as {
        campaigns?: CampaignSettings[];
        verdicts?: CampaignVerdict[];
        summary?: ComplianceSummary;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load settings");
      setData((p) => ({
        ...p,
        [id]: {
          state: "done",
          campaigns: json.campaigns ?? [],
          verdicts: json.verdicts ?? [],
          summary: json.summary ?? { evaluated: 0, passed: 0, errors: 0, unmatched: 0, compliancePct: null },
        },
      }));
    } catch (e) {
      setData((p) => ({ ...p, [id]: { state: "error", error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  function toggleFailures(id: string) {
    setOpenFailures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className={cn(TH, "pl-4")}>Campaign</th>
            <th className={TH}>Compliance</th>
            <th className={TH}>Status</th>
            <th className={TH}>Type</th>
            <th className={TH}>Bidding</th>
            <th className={TH}>Budget</th>
            <th className={TH}>Delivery</th>
            <th className={TH}>Networks</th>
            <th className={TH}>Ad serving</th>
            <th className={TH}>End date</th>
            <th className={cn(TH, "pr-4")}>Tracking</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {accounts.map((a) => {
            const isOpen = open.has(a.id);
            const d = data[a.id];
            const verdictMap = d?.state === "done" ? new Map(d.verdicts.map((v) => [v.campaignId, v])) : null;
            return (
              <Fragment key={a.id}>
                <tr className="cursor-pointer bg-muted/20 hover:bg-muted/40" onClick={() => toggle(a.id)}>
                  <td colSpan={COLS} className={cn(TD, "pl-4 font-medium")}>
                    <span className="inline-flex items-center gap-2">
                      <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                      {a.name}
                      {d?.state === "done" && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {d.summary.evaluated === 0
                            ? `· ${d.campaigns.length} campaigns · no standards matched`
                            : `· ${d.summary.compliancePct === null ? "—" : Math.round(d.summary.compliancePct * 100)}% compliant · ${d.summary.passed} pass · ${d.summary.errors} error · ${d.summary.unmatched} unmatched`}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
                {isOpen && d?.state === "loading" && (
                  <tr><td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-muted-foreground">Loading settings…</td></tr>
                )}
                {isOpen && d?.state === "error" && (
                  <tr><td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-red-700 dark:text-red-400">{d.error}</td></tr>
                )}
                {isOpen && d?.state === "done" && d.campaigns.length === 0 && (
                  <tr><td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-muted-foreground">No active campaigns.</td></tr>
                )}
                {isOpen &&
                  d?.state === "done" &&
                  d.campaigns.map((c) => {
                    const v = verdictMap?.get(c.campaignId);
                    const hasFailures = (v?.failures.length ?? 0) > 0;
                    const showFailures = hasFailures && openFailures.has(c.campaignId);
                    return (
                      <Fragment key={c.campaignId}>
                        <tr
                          className={cn("hover:bg-muted/30", hasFailures && "cursor-pointer")}
                          onClick={hasFailures ? () => toggleFailures(c.campaignId) : undefined}
                        >
                          <td className={cn(TD, "pl-10")}>
                            <span className="inline-flex items-center gap-1.5">
                              {hasFailures && (
                                <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", showFailures && "rotate-90")} />
                              )}
                              {c.name}
                            </span>
                          </td>
                          <td className={TD}>{v ? <VerdictBadge verdict={v.verdict} /> : "—"}</td>
                          <td className={TD}><StatusBadge status={c.status} /></td>
                          <td className={cn(TD, "text-muted-foreground")}>{enumLabel(c.type)}</td>
                          <td className={cn(TD, "text-muted-foreground")}>{enumLabel(c.biddingStrategy)}</td>
                          <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                            {c.dailyBudget === null ? "—" : `${money0(c.dailyBudget)}/day`}
                            {c.budgetShared && <span className="ml-1 text-[10px] text-muted-foreground">shared</span>}
                          </td>
                          <td className={cn(TD, "text-muted-foreground")}>{enumLabel(c.budgetDelivery)}</td>
                          <td className={TD}><NetworkPills n={c.networks} /></td>
                          <td className={cn(TD, "text-muted-foreground")}>{enumLabel(c.adServing)}</td>
                          <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{c.endDate ?? "No end"}</td>
                          <td className={cn(TD, "pr-4 text-muted-foreground")}>{c.trackingTemplate ? "Set" : "Not set"}</td>
                        </tr>
                        {showFailures && v && (
                          <tr className="bg-red-500/[0.03]">
                            <td className={TD} />
                            <td colSpan={COLS - 1} className="px-3 py-2 pl-10 text-xs">
                              <span className="text-muted-foreground">Against {v.standardName}: </span>
                              {v.failures.map((f, i) => (
                                <span key={f.key} className="text-foreground">
                                  {i > 0 && " · "}
                                  {f.label}: expected <span className="font-medium">{fmtValue(f.expected)}</span>, is{" "}
                                  <span className="font-medium text-red-700 dark:text-red-400">{fmtValue(f.actual)}</span>
                                </span>
                              ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={COLS} className="px-4 py-8 text-center text-sm text-muted-foreground">
                No Google Ads accounts linked.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Click an account to load its campaigns, scored against your{" "}
        <Link href="/ads/standards" className="underline hover:text-foreground">standards</Link>. Click a campaign with errors to
        see which settings are off. Settings pulled live.
      </p>
    </div>
  );
}
