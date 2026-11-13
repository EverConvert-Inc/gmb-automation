import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Ban, ChevronDown, CircleDollarSign, EyeOff, MousePointerClick, Scale, Search, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/ui/section-card";
import { StatTile } from "@/components/ui/stat-tile";
import {
  AdsDashboardHeader,
  Change,
  fmtConv,
  fmtCostPerConv,
  fmtDay,
  fmtInt,
  fmtUsd,
  StoredDataBanners,
  TD,
  TDR,
  TH,
  THEAD,
  THR,
} from "@/components/ads-dashboard-ui";
import {
  getAdsDashboardClient,
  getSearchTermsReport,
  type SearchTermRow,
  type Totals,
} from "@/lib/queries-ads-dashboard";
import { isFullySynced, resolveWindow } from "@/lib/ads-dashboard-compare";
import { daysAgoIsoEastern, yesterdayIsoEastern } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Search terms" };

const TOP_N = 50;

function TermCell({ r }: { r: SearchTermRow }) {
  return (
    <td className={TD}>
      <div className="font-medium">{r.searchTerm}</div>
      <div className="text-[10px] text-muted-foreground">
        {r.keywords.length > 0 ? `Keyword: ${r.keywords.join(", ")}` : null}
        {r.hasKeywordless && (
          <Badge variant="outline" size="sm" className={r.keywords.length > 0 ? "ml-1.5" : undefined}>
            no keyword
          </Badge>
        )}
      </div>
    </td>
  );
}

type TermTableProps = { rows: SearchTermRow[]; showConversions: boolean; comparable: boolean };

function TermTable({ rows, showConversions, comparable }: TermTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className={THEAD}>
          <tr>
            <th className={TH}>Search term</th>
            <th className={THR}>Clicks</th>
            <th className={THR}>Cost</th>
            <th className={THR}>Cost change</th>
            {showConversions && <th className={THR}>Conversions</th>}
            {showConversions && <th className={THR}>Cost / conv.</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.searchTerm}>
              <TermCell r={r} />
              <td className={TDR}>{fmtInt(r.clicks)}</td>
              <td className={TDR}>{fmtUsd(r.cost)}</td>
              <td className={TDR}>
                <Change current={r.cost} prior={r.prior?.cost ?? null} invert comparable={comparable} />
              </td>
              {showConversions && <td className={TDR}>{fmtConv(r.conversions)}</td>}
              {showConversions && <td className={TDR}>{fmtCostPerConv(r.cost, r.conversions)}</td>}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showConversions ? 6 : 4} className="px-3 py-6 text-center text-muted-foreground">
                No search terms in this date range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Top N visible, the rest behind a native <details> (no client JS).
function CollapsedTerms({ rows, showConversions, comparable }: TermTableProps) {
  const top = rows.slice(0, TOP_N);
  const rest = rows.slice(TOP_N);
  return (
    <>
      <TermTable rows={top} showConversions={showConversions} comparable={comparable} />
      {rest.length > 0 && (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            <span className="group-open:hidden">Show {rest.length} more</span>
            <span className="hidden group-open:inline">Hide</span>
          </summary>
          <div className="mt-3">
            <TermTable rows={rest} showConversions={showConversions} comparable={comparable} />
          </div>
        </details>
      )}
    </>
  );
}

function ReconRow({
  label,
  note,
  t,
  prior,
  total,
  comparable,
  gap = false,
  bold = false,
}: {
  comparable: boolean;
  label: string;
  note?: string;
  t: Totals;
  prior: Totals;
  total: Totals;
  gap?: boolean;
  bold?: boolean;
}) {
  return (
    <tr className={gap ? "bg-amber-500/[0.06]" : bold ? "bg-muted/40 font-semibold" : undefined}>
      <td className={TD}>
        <div className={bold ? undefined : "font-medium"}>{label}</div>
        {note && <div className="text-[10px] font-normal text-muted-foreground">{note}</div>}
      </td>
      <td className={TDR}>{fmtInt(t.clicks)}</td>
      <td className={TDR}>{fmtUsd(t.cost)}</td>
      <td className={TDR}>{total.cost > 0 ? `${((t.cost / total.cost) * 100).toFixed(0)}%` : "—"}</td>
      <td className={TDR}>{fmtConv(t.conversions)}</td>
      <td className={TDR}>
        <Change current={t.cost} prior={prior.cost} invert comparable={comparable} />
      </td>
    </tr>
  );
}

// Search terms report for one client: what people actually typed, from the
// stored ppc_search_terms_daily rows (Search campaigns, clicks > 0),
// reconciled against Search campaign totals with two separate gap rows.
export default async function SearchTermsPage({
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
  const report = await getSearchTermsReport(id, { from: w.from, to: w.to }, w.prior);
  const rec = report.reconciliation;
  const prior = report.priorReconciliation;
  const comparable = isFullySynced(report.coverage) && isFullySynced(report.priorCoverage);
  const zeroConv = report.rows.filter((r) => r.conversions === 0);
  const zeroConvCost = zeroConv.reduce((n, r) => n + r.cost, 0);
  const listedCost = rec.listedKeyworded.cost + rec.listedKeywordless.cost;
  const eyebrow = `Search campaigns · ${fmtDay(w.from)} – ${fmtDay(w.to)}`;

  return (
    <div className="space-y-6">
      <AdsDashboardHeader client={client} tab="search-terms" window={w} />
      <StoredDataBanners coverage={report.coverage} priorCoverage={report.priorCoverage} window={w} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Search spend"
          value={fmtUsd(rec.campaign.cost)}
          sublabel={<Change current={rec.campaign.cost} prior={prior.campaign.cost} invert comparable={comparable} />}
          icon={<CircleDollarSign className="h-4 w-4" />}
          tone="brand"
        />
        <StatTile
          label="Clicks"
          value={fmtInt(rec.campaign.clicks)}
          sublabel={<Change current={rec.campaign.clicks} prior={prior.campaign.clicks} comparable={comparable} />}
          icon={<MousePointerClick className="h-4 w-4" />}
        />
        <StatTile
          label="Conversions"
          value={fmtConv(rec.campaign.conversions)}
          sublabel={<Change current={rec.campaign.conversions} prior={prior.campaign.conversions} comparable={comparable} />}
          icon={<Target className="h-4 w-4" />}
        />
        <StatTile
          label="Spend with a visible term"
          value={rec.campaign.cost > 0 ? `${((listedCost / rec.campaign.cost) * 100).toFixed(0)}%` : "—"}
          sublabel={`${fmtUsd(listedCost)} of ${fmtUsd(rec.campaign.cost)}`}
          icon={<EyeOff className="h-4 w-4" />}
        />
      </div>

      <SectionCard icon={<Scale className="h-4 w-4" />} title="Where the Search spend went" eyebrow={eyebrow}>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}> </th>
                <th className={THR}>Clicks</th>
                <th className={THR}>Cost</th>
                <th className={THR}>% of spend</th>
                <th className={THR}>Conversions</th>
                <th className={THR}>Cost change</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <ReconRow comparable={comparable}
                label="Listed terms — triggered by a keyword"
                t={rec.listedKeyworded}
                prior={prior.listedKeyworded}
                total={rec.campaign}
              />
              <ReconRow comparable={comparable}
                label="Listed terms — no keyword"
                note="Shown by Google without any keyword of yours triggering them"
                t={rec.listedKeywordless}
                prior={prior.listedKeywordless}
                total={rec.campaign}
              />
              <ReconRow comparable={comparable}
                gap
                label="Gap 1 · Privacy-hidden terms"
                note="Keyword clicks whose search term Google withholds. Keyword totals minus the listed keyword-triggered terms."
                t={rec.privacyHidden}
                prior={prior.privacyHidden}
                total={rec.campaign}
              />
              <ReconRow comparable={comparable}
                gap
                label="Gap 2 · No-keyword clicks with no term reported"
                note={`Search campaign totals minus keyword totals (${fmtInt(rec.keywordlessAll.clicks)} clicks, ${fmtUsd(rec.keywordlessAll.cost)} had no keyword), minus the no-keyword terms listed above.`}
                t={rec.keywordlessUnlisted}
                prior={prior.keywordlessUnlisted}
                total={rec.campaign}
              />
            </tbody>
            <tfoot className="border-t">
              <ReconRow comparable={comparable} bold label="Search campaign total" t={rec.campaign} prior={prior.campaign} total={rec.campaign} />
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The four rows add up to the Search campaign total. Only terms with at least one click are
          stored, so impressions are not reconciled here.
        </p>
      </SectionCard>

      <SectionCard icon={<Search className="h-4 w-4" />} title="Top search terms by cost" eyebrow={eyebrow}>
        <CollapsedTerms comparable={comparable} rows={report.rows} showConversions />
      </SectionCard>

      <SectionCard
        icon={<Ban className="h-4 w-4" />}
        title="Zero-conversion terms"
        eyebrow={`Negative-keyword candidates · ${zeroConv.length} terms · ${fmtUsd(zeroConvCost)}`}
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Terms that cost money and recorded no conversion in this window, most expensive first.
          Conversions are credited back to the click date and can arrive weeks later, and one or two
          clicks prove little — treat these as candidates to review, not a list to block. Whether a
          “conversion” is a real lead depends on the Conversion audit tab.
        </p>
        <CollapsedTerms comparable={comparable} rows={zeroConv} showConversions={false} />
      </SectionCard>
    </div>
  );
}
