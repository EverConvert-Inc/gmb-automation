"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignSettings } from "@/lib/queries-ads-dashboard";
import { enumLabel, money0 } from "@/lib/google-ads-format";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2";
const COLS = 10;

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

type Breakdown =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "done"; campaigns: CampaignSettings[] };

export function GoogleAdsAuditTable({ accounts }: { accounts: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
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
      const json = (await res.json()) as { campaigns?: CampaignSettings[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load settings");
      setData((p) => ({ ...p, [id]: { state: "done", campaigns: json.campaigns ?? [] } }));
    } catch (e) {
      setData((p) => ({ ...p, [id]: { state: "error", error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className={cn(TH, "pl-4")}>Campaign</th>
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
            return (
              <Fragment key={a.id}>
                <tr className="cursor-pointer bg-muted/20 hover:bg-muted/40" onClick={() => toggle(a.id)}>
                  <td colSpan={COLS} className={cn(TD, "pl-4 font-medium")}>
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                      {a.name}
                      {d?.state === "done" && (
                        <span className="text-xs font-normal text-muted-foreground">· {d.campaigns.length} campaigns</span>
                      )}
                    </span>
                  </td>
                </tr>
                {isOpen && d?.state === "loading" && (
                  <tr>
                    <td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-muted-foreground">Loading settings…</td>
                  </tr>
                )}
                {isOpen && d?.state === "error" && (
                  <tr>
                    <td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-red-700 dark:text-red-400">{d.error}</td>
                  </tr>
                )}
                {isOpen && d?.state === "done" && d.campaigns.length === 0 && (
                  <tr>
                    <td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-muted-foreground">No active campaigns.</td>
                  </tr>
                )}
                {isOpen &&
                  d?.state === "done" &&
                  d.campaigns.map((c) => (
                    <tr key={c.campaignId} className="hover:bg-muted/30">
                      <td className={cn(TD, "pl-10")}>{c.name}</td>
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
                  ))}
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
        Click an account to load its campaigns and settings (pulled live). Settings compliance against standards is coming next.
      </p>
    </div>
  );
}
