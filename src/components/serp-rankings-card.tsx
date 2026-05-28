import Link from "next/link";
import { AlertTriangle, KeyRound, Search } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { SectionCard } from "@/components/ui/section-card";
import type { RankAnnotation, RankingsOverviewRow } from "@/lib/queries";

const NO_GEO_KEY = "__no_geo__";

function RankCell({ ann }: { ann: RankAnnotation | null }) {
  if (ann == null) {
    return <span className="text-xs italic text-muted-foreground">—</span>;
  }
  if (ann.kind === "nr") {
    return <span className="text-muted-foreground">NR</span>;
  }
  if (ann.kind === "nr_lost") {
    return (
      <span className="text-red-700" title={`Previously #${ann.priorRank}`}>
        NR (LOST)
      </span>
    );
  }
  const { rank, delta, isNew, isWrongPage, actualUrl } = ann;
  let annotation: React.ReactNode = null;
  let toneClass = "text-foreground";
  if (isNew) {
    annotation = <span className="ml-1 text-green-700">(NEW)</span>;
    toneClass = "text-green-700";
  } else if (delta != null && delta > 0) {
    annotation = <span className="ml-1 text-green-700">(+{delta})</span>;
    toneClass = "text-green-700";
  } else if (delta != null && delta < 0) {
    annotation = <span className="ml-1 text-red-700">({delta})</span>;
    toneClass = "text-red-700";
  } else if (delta === 0) {
    annotation = <span className="ml-1 text-muted-foreground">(–)</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`font-medium tabular-nums ${toneClass}`}>#{rank}</span>
      {annotation}
      {isWrongPage && (
        <span
          title={actualUrl ? `Ranking page: ${actualUrl}` : "Wrong page"}
          className="inline-flex items-center text-amber-700"
        >
          <AlertTriangle className="h-3 w-3" />
          <span className="ml-0.5 text-xs">other URL</span>
        </span>
      )}
    </span>
  );
}

export function SerpRankingsCard({
  data,
  clientSlug,
}: {
  data: RankingsOverviewRow[];
  clientSlug: string;
}) {
  if (data.length === 0) {
    return (
      <SectionCard
        icon={<Search className="h-4 w-4" />}
        title="Search rankings"
        eyebrow="Organic visibility"
      >
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="rounded-full bg-brand/10 p-4">
            <KeyRound className="h-7 w-7 text-brand" />
          </div>
          <div className="max-w-md space-y-1.5">
            <p className="text-sm font-medium">No tracked keywords yet</p>
            <p className="text-xs text-muted-foreground">
              Add the keywords you want to rank for, the target page on your
              site, and the city you want to be searched from. We&apos;ll check
              Google every Thursday and surface in-city ranks here.
            </p>
          </div>
          <Link
            href={`/clients/${clientSlug}/keywords`}
            className={buttonClasses("outline", "sm")}
          >
            Manage keywords
          </Link>
        </div>
      </SectionCard>
    );
  }

  // Group keywords by city. Keywords without a geo are shown at the top
  // under "No geo set" so they're visible (and editable) but their rank
  // cells stay empty since we no longer run national searches.
  const byCity = new Map<string, RankingsOverviewRow[]>();
  for (const r of data) {
    const key = r.geoCity ?? NO_GEO_KEY;
    const list = byCity.get(key);
    if (list) list.push(r);
    else byCity.set(key, [r]);
  }
  const cityKeys = Array.from(byCity.keys()).sort((a, b) => {
    if (a === NO_GEO_KEY) return -1;
    if (b === NO_GEO_KEY) return 1;
    return a.localeCompare(b);
  });

  return (
    <SectionCard
      icon={<Search className="h-4 w-4" />}
      title={
        <span className="inline-flex items-center gap-1.5">
          Search rankings
          <InfoTooltip>
            Two ranks per keyword, both as searched from within the configured
            city: the full keyword as listed, and the keyword with the city
            name stripped. Lower number = closer to #1.
          </InfoTooltip>
        </span>
      }
      eyebrow="Organic visibility"
      actions={
        <Link
          href={`/clients/${clientSlug}/keywords`}
          className={buttonClasses("outline", "sm")}
        >
          Manage keywords
        </Link>
      }
      contentClassName="space-y-6 p-5"
    >
      {cityKeys.map((city) => {
          const rows = byCity.get(city)!;
          const isNoGeo = city === NO_GEO_KEY;
          return (
            <section key={city}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isNoGeo ? "No geo set (won't scan)" : city}
              </h3>
              {/* Mobile: stacked card per keyword. Each card lays out the
                  two ranks side-by-side so the user doesn't have to
                  horizontally scroll a four-column table. */}
              <div className="space-y-2 sm:hidden">
                {rows.map((r) => (
                  <div
                    key={`m-${r.trackedKeywordId}`}
                    className="rounded-md border bg-background p-3"
                  >
                    <div className="font-medium">{r.keyword}</div>
                    {r.bareKeyword && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        bare: &ldquo;{r.bareKeyword}&rdquo;
                      </div>
                    )}
                    <a
                      href={r.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block truncate text-xs text-brand hover:underline"
                      title={r.targetUrl}
                    >
                      {r.targetUrl.replace(/^https?:\/\//, "")}
                    </a>
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 text-sm">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {isNoGeo ? "Full kw" : `In ${city}: full`}
                        </div>
                        <RankCell ann={r.geoFull} />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {isNoGeo ? "Bare kw" : `In ${city}: bare`}
                        </div>
                        {r.bareKeyword ? (
                          <RankCell ann={r.geoBare} />
                        ) : (
                          <span className="text-xs italic text-muted-foreground">
                            same as full
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto rounded-md border sm:block">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">H1 / Target Keyword</th>
                      <th className="px-3 py-2 font-medium">URL</th>
                      <th className="px-3 py-2 font-medium text-right">
                        <span className="inline-flex items-center gap-1">
                          {isNoGeo ? "Full kw" : `In ${city}: full kw`}
                          <InfoTooltip>
                            The keyword as listed
                            {isNoGeo
                              ? ", searched from the configured city."
                              : `, searched from within ${city}.`}
                          </InfoTooltip>
                        </span>
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        <span className="inline-flex items-center gap-1">
                          {isNoGeo ? "Bare kw" : `In ${city}: bare kw`}
                          <InfoTooltip>
                            The keyword with the city name stripped (e.g.
                            &ldquo;car accident lawyer&rdquo; for
                            &ldquo;{isNoGeo ? "<city>" : city} car accident
                            lawyer&rdquo;), searched from the same location.
                            Usually the most meaningful signal — most local
                            searchers don&apos;t type their city.
                          </InfoTooltip>
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.trackedKeywordId} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.keyword}</div>
                          {r.bareKeyword && (
                            <div className="text-[11px] text-muted-foreground">
                              bare: &ldquo;{r.bareKeyword}&rdquo;
                            </div>
                          )}
                        </td>
                        <td
                          className="px-3 py-2 text-muted-foreground"
                          title={r.targetUrl}
                        >
                          <a
                            href={r.targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block max-w-[32ch] truncate text-brand hover:underline"
                          >
                            {r.targetUrl.replace(/^https?:\/\//, "")}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <RankCell ann={r.geoFull} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {r.bareKeyword ? (
                            <RankCell ann={r.geoBare} />
                          ) : (
                            <span
                              className="text-xs italic text-muted-foreground"
                              title="No city in the keyword to strip — bare = full"
                            >
                              same as full
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
    </SectionCard>
  );
}
