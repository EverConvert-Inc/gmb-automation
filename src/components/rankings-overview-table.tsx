import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { RankAnnotation, RankingsOverviewRow } from "@/lib/queries";

// Deterministic color assignment per client slug. Keeps badge colors
// consistent across renders without storing them in the DB.
const CLIENT_PALETTE = [
  "bg-green-100 text-green-900 border-green-200",
  "bg-amber-100 text-amber-900 border-amber-200",
  "bg-rose-100 text-rose-900 border-rose-200",
  "bg-sky-100 text-sky-900 border-sky-200",
  "bg-teal-100 text-teal-900 border-teal-200",
  "bg-violet-100 text-violet-900 border-violet-200",
  "bg-indigo-100 text-indigo-900 border-indigo-200",
  "bg-orange-100 text-orange-900 border-orange-200",
  "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-200",
  "bg-lime-100 text-lime-900 border-lime-200",
];

function clientColor(slug: string): string {
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

function ClientBadge({ name, slug }: { name: string; slug: string }) {
  return (
    <Link
      href={`/clients/${slug}`}
      className={`inline-flex max-w-[28ch] items-center truncate whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${clientColor(slug)} hover:opacity-80`}
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
    <div className="overflow-x-auto rounded-md border">
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
  );
}
