import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { badgeClasses, type BadgeColour } from "@/components/ui/badge";
import type { RankAnnotation, RankingsOverviewRow } from "@/lib/queries";

// Deterministic color assignment per client slug. Keeps badge colors
// consistent across renders without storing them in the DB.
const CLIENT_PALETTE: BadgeColour[] = ["green", "amber", "rose", "sky", "teal", "violet", "indigo", "orange", "fuchsia", "lime"];

function clientColor(slug: string): BadgeColour {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  return CLIENT_PALETTE[hash % CLIENT_PALETTE.length];
}

function RankCell({ ann }: { ann: RankAnnotation }) {
  if (ann.kind === "nr") {
    return <span className="text-muted-foreground">NR</span>;
  }
  if (ann.kind === "nr_lost") {
    return (
      <span className="text-red-700 dark:text-red-400" title={`Previously #${ann.priorRank}`}>
        NR (LOST)
      </span>
    );
  }
  const { rank, delta, isNew, isWrongPage, actualUrl } = ann;
  let annotation: React.ReactNode = null;
  let toneClass = "text-foreground";
  if (isNew) {
    annotation = <span className="ml-1 text-green-800 dark:text-green-400">(NEW)</span>;
    toneClass = "text-green-800 dark:text-green-400";
  } else if (delta != null && delta > 0) {
    annotation = <span className="ml-1 text-green-800 dark:text-green-400">(+{delta})</span>;
    toneClass = "text-green-800 dark:text-green-400";
  } else if (delta != null && delta < 0) {
    annotation = <span className="ml-1 text-red-700 dark:text-red-400">({delta})</span>;
    toneClass = "text-red-700 dark:text-red-400";
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
          className="inline-flex items-center text-amber-800 dark:text-amber-400"
        >
          <AlertTriangle className="h-3 w-3" />
          <span className="ml-0.5 text-xs">other URL</span>
        </span>
      )}
    </span>
  );
}

function ClientBadge({ name, slug }: { name: string; slug: string }) {
  return (
    <Link
      href={`/clients/${slug}`}
      className={badgeClasses(clientColor(slug), "default", "max-w-[28ch] truncate whitespace-nowrap rounded-full border border-transparent hover:opacity-80")}
      title={name}
    >
      {name}
    </Link>
  );
}

export function RankingsOverviewTable({ rows }: { rows: RankingsOverviewRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/10 px-6 py-12 text-center">
        <p className="text-sm font-medium">No tracked keywords yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add keywords on a client&apos;s page, or run{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">npm run seed:big5</code>{" "}
          to seed the Big 5.
        </p>
      </div>
    );
  }
  return (
    <>
      {/* Mobile: card-per-keyword. Same data as the table, but stacked
          so no horizontal scroll. Ranks go in a two-column footer like
          the per-client SerpRankingsCard. */}
      <div className="space-y-3 sm:hidden">
        {rows.map((r) => (
          <div
            key={`m-${r.trackedKeywordId}`}
            className="rounded-md border bg-background p-3"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <ClientBadge name={r.clientName} slug={r.clientSlug} />
              {r.geoCity && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {r.geoCity}
                </span>
              )}
            </div>
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
                  In-city · full
                </div>
                {r.geoFull ? (
                  <RankCell ann={r.geoFull} />
                ) : (
                  <span className="text-xs italic text-muted-foreground">
                    no geo set
                  </span>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  In-city · bare
                </div>
                {r.geoBare ? (
                  <RankCell ann={r.geoBare} />
                ) : r.geoFull ? (
                  <span className="text-xs italic text-muted-foreground">
                    same as full
                  </span>
                ) : (
                  <span className="text-xs italic text-muted-foreground">—</span>
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
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">H1 / Target Keyword</th>
            <th className="px-3 py-2 font-medium">URL</th>
            <th className="px-3 py-2 font-medium text-right" title="Full keyword (including city) searched from within the city">
              In-city · full
            </th>
            <th className="px-3 py-2 font-medium text-right" title="Keyword with city stripped (e.g. 'car accident lawyer') searched from within the city. Usually the most meaningful.">
              In-city · bare
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.trackedKeywordId} className="border-b last:border-0">
              <td className="px-3 py-2">
                <ClientBadge name={r.clientName} slug={r.clientSlug} />
              </td>
              <td className="px-3 py-2">
                <div className="font-medium">{r.keyword}</div>
                {r.bareKeyword && (
                  <div className="text-[11px] text-muted-foreground">
                    bare: &ldquo;{r.bareKeyword}&rdquo;
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground" title={r.targetUrl}>
                <a
                  href={r.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block max-w-[40ch] truncate text-brand hover:underline"
                >
                  {r.targetUrl.replace(/^https?:\/\//, "")}
                </a>
              </td>
              <td className="px-3 py-2 text-right">
                {r.geoFull ? (
                  <div className="flex flex-col items-end">
                    <RankCell ann={r.geoFull} />
                    {r.geoCity && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {r.geoCity}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs italic text-muted-foreground">
                    no geo set
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {r.geoBare ? (
                  <RankCell ann={r.geoBare} />
                ) : r.geoFull ? (
                  <span
                    className="text-xs italic text-muted-foreground"
                    title="No city in the keyword to strip — same as full"
                  >
                    same as full
                  </span>
                ) : (
                  <span className="text-xs italic text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
