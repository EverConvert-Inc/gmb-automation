"use client";

import { Fragment, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { AdminSelect } from "@/components/leads/admin-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import type { CampaignSettings } from "@/lib/queries-ads-dashboard";
import type { CampaignVerdict, ComplianceSummary, FieldUnverified, Verdict } from "@/lib/ads-standards";
import { enumLabel, money0 } from "@/lib/google-ads-format";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2";
const COLS = 10;

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
    review: ["bg-amber-500/10 text-amber-700 dark:text-amber-400", "Needs review"],
    unmatched: ["bg-muted text-muted-foreground", "Unmatched"],
  } as const;
  const [cls, label] = map[verdict];
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", cls)}>{label}</span>;
}

const VERDICT_FILTERS: Array<{ value: "all" | Verdict; label: string }> = [
  { value: "all", label: "All results" },
  { value: "error", label: "Error" },
  { value: "review", label: "Needs review" },
  { value: "passed", label: "Pass" },
  { value: "unmatched", label: "Unmatched" },
];

const STATUS_FILTERS = [
  { value: "all", label: "Any status" },
  { value: "ENABLED", label: "Enabled" },
  { value: "PAUSED", label: "Paused" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

function unverifiedReason(u: FieldUnverified, type: string): string {
  return u.reason === "not_applicable" ? `doesn't apply to ${enumLabel(type)}` : "Google returned no value";
}

const EMPTY_SUMMARY: ComplianceSummary = { evaluated: 0, passed: 0, errors: 0, review: 0, unmatched: 0, compliancePct: null };
const LOAD_ALL_CONCURRENCY = 4;

type Breakdown =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "done"; campaigns: CampaignSettings[]; verdicts: CampaignVerdict[]; summary: ComplianceSummary };

export function GoogleAdsAuditTable({ accounts }: { accounts: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Record<string, Breakdown>>({});
  const [query, setQuery] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<"all" | Verdict>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loadingAll, setLoadingAll] = useState(false);
  // Accounts already requested, so a toggle during "Load all" can't double-fetch.
  const requested = useRef<Set<string>>(new Set());

  async function load(id: string) {
    if (requested.current.has(id)) return;
    requested.current.add(id);
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
          summary: json.summary ?? EMPTY_SUMMARY,
        },
      }));
    } catch (e) {
      // A failed account can be retried by collapsing and expanding it again.
      requested.current.delete(id);
      setData((p) => ({ ...p, [id]: { state: "error", error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  function toggle(id: string) {
    const willOpen = !open.has(id);
    setOpen((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(id);
      else next.delete(id);
      return next;
    });
    if (willOpen) void load(id);
  }

  // Loads every account (a few at a time — each is a live Google Ads query)
  // and opens them all, so the filters work across the whole portfolio.
  async function loadAll() {
    setLoadingAll(true);
    setOpen(new Set(accounts.map((a) => a.id)));
    const queue = accounts.map((a) => a.id);
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) await load(id);
    };
    await Promise.all(Array.from({ length: LOAD_ALL_CONCURRENCY }, worker));
    setLoadingAll(false);
  }

  function toggleDetails(id: string) {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const filtering = q !== "" || verdictFilter !== "all" || statusFilter !== "all";
  function campaignVisible(c: CampaignSettings, v: CampaignVerdict | undefined): boolean {
    if (q && !c.name.toLowerCase().includes(q)) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (verdictFilter !== "all" && v?.verdict !== verdictFilter) return false;
    return true;
  }
  const loadedCount = accounts.filter((a) => data[a.id]?.state === "done").length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative w-full sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campaigns"
            aria-label="Search campaigns"
            className="pl-8"
          />
        </div>
        <div className="w-full sm:w-44">
          <AdminSelect
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value as "all" | Verdict)}
            aria-label="Filter by compliance"
          >
            {VERDICT_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </AdminSelect>
        </div>
        <div className="w-full sm:w-36">
          <AdminSelect
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by campaign status"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </AdminSelect>
        </div>
        <span className="text-xs text-muted-foreground">
          {loadedCount} of {accounts.length} accounts loaded
          {filtering && loadedCount < accounts.length && " · filters apply to loaded accounts"}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void loadAll()}
          disabled={loadingAll || loadedCount === accounts.length}
        >
          {loadingAll ? "Loading…" : "Load all accounts"}
        </Button>
      </div>
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
            <th className={cn(TH, "pr-4")}>Tracking</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {accounts.map((a) => {
            const isOpen = open.has(a.id);
            const d = data[a.id];
            const verdictMap = d?.state === "done" ? new Map(d.verdicts.map((v) => [v.campaignId, v])) : null;
            const shown =
              d?.state === "done" ? d.campaigns.filter((c) => campaignVisible(c, verdictMap?.get(c.campaignId))) : [];
            // While filtering, a loaded account with nothing matching drops out
            // so the table reads as "where are the problems".
            if (filtering && d?.state === "done" && shown.length === 0) return null;
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
                            : `· ${d.summary.compliancePct === null ? "—" : Math.round(d.summary.compliancePct * 100)}% compliant · ${d.summary.passed} pass · ${d.summary.errors} error${d.summary.review > 0 ? ` · ${d.summary.review} needs review` : ""} · ${d.summary.unmatched} unmatched`}
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
                {isOpen && d?.state === "done" && d.campaigns.length > 0 && shown.length === 0 && (
                  <tr><td colSpan={COLS} className="px-3 py-2 pl-10 text-xs text-muted-foreground">No campaigns match the filters.</td></tr>
                )}
                {isOpen &&
                  d?.state === "done" &&
                  shown.map((c) => {
                    const v = verdictMap?.get(c.campaignId);
                    const hasDetails = (v?.failures.length ?? 0) + (v?.unverified?.length ?? 0) > 0;
                    const showDetails = hasDetails && openDetails.has(c.campaignId);
                    return (
                      <Fragment key={c.campaignId}>
                        <tr
                          className={cn("hover:bg-muted/30", hasDetails && "cursor-pointer")}
                          onClick={hasDetails ? () => toggleDetails(c.campaignId) : undefined}
                        >
                          <td className={cn(TD, "pl-10")}>
                            <span className="inline-flex items-center gap-1.5">
                              {hasDetails && (
                                <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", showDetails && "rotate-90")} />
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
                          <td className={cn(TD, "pr-4 text-muted-foreground")}>{c.trackingTemplate ? "Set" : "Not set"}</td>
                        </tr>
                        {showDetails && v && (
                          <tr className={v.failures.length > 0 ? "bg-red-500/[0.03]" : "bg-amber-500/[0.03]"}>
                            <td className={TD} />
                            <td colSpan={COLS - 1} className="space-y-1 px-3 py-2 pl-10 text-xs">
                              {v.failures.length > 0 && (
                                <div>
                                  <span className="text-muted-foreground">Against {v.standardName}: </span>
                                  {v.failures.map((f, i) => (
                                    <span key={f.key} className="text-foreground">
                                      {i > 0 && " · "}
                                      {f.label}: expected <span className="font-medium">{fmtValue(f.expected)}</span>, is{" "}
                                      <span className="font-medium text-red-700 dark:text-red-400">{fmtValue(f.actual)}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {(v.unverified?.length ?? 0) > 0 && (
                                <div>
                                  <span className="text-muted-foreground">Not checked against {v.standardName}: </span>
                                  {v.unverified.map((u, i) => (
                                    <span key={u.key} className="text-foreground">
                                      {i > 0 && " · "}
                                      {u.label} <span className="text-amber-700 dark:text-amber-400">({unverifiedReason(u, c.type)})</span>
                                    </span>
                                  ))}
                                </div>
                              )}
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
      </div>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Click an account to load its campaigns, scored against your{" "}
        <Link href="/ads/standards" className="underline hover:text-foreground">standards</Link>. Click a campaign with errors
        to see which settings are off. Needs review means it matched a standard but an enforced setting couldn&apos;t be
        judged (it doesn&apos;t apply to that campaign type, or Google returned no value), so it neither passes nor fails.
        Compliance % counts pass and error only. Settings pulled live.
      </p>
    </div>
  );
}
