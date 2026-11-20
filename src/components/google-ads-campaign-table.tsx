"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignRow } from "@/lib/queries-google-ads-overview";
import type { AdGroupBreakdownRow, AssetGroupRow } from "@/lib/queries-ads-dashboard";
import { conv1, enumLabel, int, money0, money2, pct2 } from "@/lib/google-ads-format";

const TH = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const THR = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2";
const TDR = "px-3 py-2 text-right tabular-nums";

// 1 empty Account cell + a colSpan over the remaining 10 columns = full width.
const SPAN = 10;

type Metrics = {
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cost: number;
  conversions: number;
  costPerConv: number | null;
};

function MetricCells({ m }: { m: Metrics }) {
  return (
    <>
      <td className={TDR}>{int(m.impressions)}</td>
      <td className={TDR}>{int(m.clicks)}</td>
      <td className={TDR}>{pct2(m.ctr)}</td>
      <td className={TDR}>{m.cpc === null ? "—" : money2(m.cpc)}</td>
      <td className={TDR}>{money0(m.cost)}</td>
      <td className={TDR}>{conv1(m.conversions)}</td>
      <td className={cn(TDR, "pr-4")}>{m.costPerConv === null ? "—" : money2(m.costPerConv)}</td>
    </>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const enabled = status === "ENABLED";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground",
      )}
    >
      {status ? enumLabel(status) : "—"}
    </span>
  );
}

const isLimited = (s: string) => s === "LIMITED" || s === "NOT_ELIGIBLE" || s === "REMOVED";

function LimitedTag({ status, className }: { status: string; className?: string }) {
  if (!isLimited(status)) return null;
  const red = status === "NOT_ELIGIBLE" || status === "REMOVED";
  return (
    <span
      className={cn(
        "text-[9px] font-medium uppercase tracking-wide",
        red ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      {red ? "not eligible" : "limited"}
    </span>
  );
}

const SECTION_LABEL = "mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground";

// A richer panel for an asset group's assets: text as chips (grouped by field
// type), images and videos as actual thumbnails — instead of one flat row per
// asset.
function AssetGroupAssets({ assets }: { assets: AssetGroupRow["assets"] }) {
  const videos = assets.filter((a) => a.videoId);
  const images = assets.filter((a) => a.imageUrl && !a.videoId);
  const texts = assets.filter((a) => !a.imageUrl && !a.videoId);

  const textGroups: { field: string; items: typeof texts }[] = [];
  for (const a of texts) {
    let g = textGroups.find((x) => x.field === a.fieldType);
    if (!g) {
      g = { field: a.fieldType, items: [] };
      textGroups.push(g);
    }
    g.items.push(a);
  }

  return (
    <div className="space-y-3">
      {textGroups.map((g) => (
        <div key={g.field}>
          <div className={SECTION_LABEL}>
            {enumLabel(g.field)} ({g.items.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {g.items.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
              >
                <span>{a.content || "—"}</span>
                <LimitedTag status={a.primaryStatus} />
              </span>
            ))}
          </div>
        </div>
      ))}

      {images.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Images ({images.length})</div>
          <div className="flex flex-wrap gap-2">
            {images.map((a, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.imageUrl ?? ""} alt="" loading="lazy" className="h-16 w-28 rounded border object-cover" />
                {isLimited(a.primaryStatus) && (
                  <LimitedTag
                    status={a.primaryStatus}
                    className="absolute left-1 top-1 rounded bg-background/90 px-1"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {videos.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Videos ({videos.length})</div>
          <div className="flex flex-wrap gap-3">
            {videos.map((a, i) => (
              <a
                key={i}
                href={`https://www.youtube.com/watch?v=${a.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="group w-36"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://i.ytimg.com/vi/${a.videoId}/mqdefault.jpg`}
                  alt=""
                  loading="lazy"
                  className="h-20 w-36 rounded border object-cover"
                />
                <div className="mt-1 truncate text-[11px] text-muted-foreground group-hover:text-foreground">
                  {a.videoTitle || "YouTube video"}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Note({ children, pad, tone }: { children: React.ReactNode; pad: string; tone?: "error" }) {
  return (
    <tr className="bg-muted/20">
      <td className={TD} />
      <td
        colSpan={SPAN}
        className={cn("px-3 py-2 text-xs", pad, tone === "error" ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}
      >
        {children}
      </td>
    </tr>
  );
}

type Breakdown =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "done"; kind: "search"; adGroups: AdGroupBreakdownRow[] }
  | { state: "done"; kind: "pmax"; assetGroups: AssetGroupRow[]; assetsError: string | null };

export function GoogleAdsCampaignTable({
  campaigns,
  total,
  range,
}: {
  campaigns: CampaignRow[];
  total: number;
  range: { from: string; to: string };
}) {
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [breakdowns, setBreakdowns] = useState<Record<string, Breakdown>>({});

  async function toggleCampaign(c: CampaignRow) {
    const willOpen = !openCampaigns.has(c.campaignId);
    setOpenCampaigns((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(c.campaignId);
      else next.delete(c.campaignId);
      return next;
    });
    if (!willOpen || breakdowns[c.campaignId]) return;

    setBreakdowns((p) => ({ ...p, [c.campaignId]: { state: "loading" } }));
    try {
      const q = new URLSearchParams({
        clientId: c.clientId,
        campaignId: c.googleAdsCampaignId,
        type: c.type ?? "",
        from: range.from,
        to: range.to,
      });
      const res = await fetch(`/api/ads/campaign-breakdown?${q.toString()}`);
      const json = (await res.json()) as {
        kind?: "search" | "pmax";
        adGroups?: AdGroupBreakdownRow[];
        assetGroups?: AssetGroupRow[];
        assetsError?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to load breakdown");
      const done: Breakdown =
        json.kind === "pmax"
          ? { state: "done", kind: "pmax", assetGroups: json.assetGroups ?? [], assetsError: json.assetsError ?? null }
          : { state: "done", kind: "search", adGroups: json.adGroups ?? [] };
      setBreakdowns((p) => ({ ...p, [c.campaignId]: done }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBreakdowns((p) => ({ ...p, [c.campaignId]: { state: "error", error: msg } }));
    }
  }

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
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
            <th className={cn(TH, "pl-4")}>Account</th>
            <th className={TH}>Campaign</th>
            <th className={TH}>Status</th>
            <th className={TH}>Type</th>
            <th className={THR}>Impr.</th>
            <th className={THR}>Clicks</th>
            <th className={THR}>CTR</th>
            <th className={THR}>CPC</th>
            <th className={THR}>Cost</th>
            <th className={THR}>Conv.</th>
            <th className={cn(THR, "pr-4")}>Cost / conv.</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {campaigns.map((c) => {
            const open = openCampaigns.has(c.campaignId);
            const d = breakdowns[c.campaignId];
            const search = d?.state === "done" && d.kind === "search" ? d : null;
            const pmax = d?.state === "done" && d.kind === "pmax" ? d : null;
            return (
              <Fragment key={c.campaignId}>
                <tr className="cursor-pointer hover:bg-muted/40" onClick={() => toggleCampaign(c)}>
                  <td className={cn(TD, "pl-4 text-muted-foreground")}>{c.accountName}</td>
                  <td className={TD}>
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight
                        className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                      />
                      <span className="font-medium">{c.name}</span>
                    </span>
                  </td>
                  <td className={TD}>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className={cn(TD, "text-muted-foreground")}>{enumLabel(c.type)}</td>
                  <MetricCells m={c} />
                </tr>

                {open && d?.state === "loading" && <Note pad="pl-10">Loading…</Note>}
                {open && d?.state === "error" && (
                  <Note pad="pl-10" tone="error">
                    {d.error}
                  </Note>
                )}

                {open && search && search.adGroups.length === 0 && (
                  <Note pad="pl-10">No ad groups with activity in this range.</Note>
                )}
                {open &&
                  search &&
                  search.adGroups.map((g) => {
                    const gopen = openGroups.has(g.id);
                    return (
                      <Fragment key={g.id}>
                        <tr className="cursor-pointer bg-muted/10 hover:bg-muted/30" onClick={() => toggleGroup(g.id)}>
                          <td className={TD} />
                          <td className={TD}>
                            <span className="inline-flex items-center gap-1.5 pl-6">
                              <ChevronRight
                                className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", gopen && "rotate-90")}
                              />
                              <span>{g.name}</span>
                            </span>
                          </td>
                          <td className={TD}>
                            <StatusBadge status={g.status} />
                          </td>
                          <td className={cn(TD, "text-muted-foreground")}>{enumLabel(g.type)}</td>
                          <MetricCells m={g} />
                        </tr>
                        {gopen && g.ads.length === 0 && <Note pad="pl-16">No ads with activity.</Note>}
                        {gopen &&
                          g.ads.map((a) => (
                            <tr key={a.id} className="bg-muted/5">
                              <td className={TD} />
                              <td className={cn(TD, "pl-16")}>
                                <span className="text-muted-foreground">{a.name}</span>
                                {a.strength && !["UNSPECIFIED", "UNKNOWN"].includes(a.strength) && (
                                  <span className="ml-2 text-[10px] text-muted-foreground">· strength {enumLabel(a.strength)}</span>
                                )}
                              </td>
                              <td className={TD}>
                                <StatusBadge status={a.status} />
                              </td>
                              <td className={cn(TD, "text-muted-foreground")}>{enumLabel(a.type)}</td>
                              <MetricCells m={a} />
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}

                {open && pmax && pmax.assetGroups.length === 0 && (
                  <Note pad="pl-10">No asset groups with activity in this range.</Note>
                )}
                {open &&
                  pmax &&
                  pmax.assetGroups.map((g) => {
                    const gopen = openGroups.has(g.id);
                    return (
                      <Fragment key={g.id}>
                        <tr className="cursor-pointer bg-muted/10 hover:bg-muted/30" onClick={() => toggleGroup(g.id)}>
                          <td className={TD} />
                          <td className={TD}>
                            <span className="inline-flex items-center gap-1.5 pl-6">
                              <ChevronRight
                                className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", gopen && "rotate-90")}
                              />
                              <span>{g.name}</span>
                            </span>
                          </td>
                          <td className={TD}>
                            <StatusBadge status={g.status} />
                          </td>
                          <td className={cn(TD, "text-muted-foreground")}>Asset group</td>
                          <MetricCells m={g} />
                        </tr>
                        {gopen && g.assets.length === 0 && (
                          <Note pad="pl-16" tone={pmax.assetsError ? "error" : undefined}>
                            {pmax.assetsError ? `Couldn't load assets: ${pmax.assetsError}` : "No assets."}
                          </Note>
                        )}
                        {gopen && g.assets.length > 0 && (
                          <tr className="bg-muted/5">
                            <td className={TD} />
                            <td colSpan={SPAN} className="px-3 py-3 pl-16">
                              <AssetGroupAssets assets={g.assets} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
          {campaigns.length === 0 && (
            <tr>
              <td colSpan={SPAN + 1} className="px-4 py-8 text-center text-sm text-muted-foreground">
                No campaigns match this filter in the selected range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        {campaigns.length} of {total} campaigns · click a row to expand ad groups and ads (asset groups and assets for Performance Max)
      </p>
    </div>
  );
}
