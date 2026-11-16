import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Generic route-loading skeleton. Its real job is to exist: a `loading.tsx`
 * that renders this gives Next a Suspense/prefetch boundary, so clicking a
 * sidebar tab swaps to this skeleton instantly instead of blocking on the
 * page's server render (several DB queries on most of these routes) with no
 * feedback. The exact shape doesn't need to match the page — it just has to
 * read as "loading" for the fraction of a second it shows.
 */
export function PageSkeleton({ cards = 2, rows = 4 }: { cards?: number; rows?: number }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      </div>
      {Array.from({ length: cards }, (_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: rows }, (_, j) => (
              <div key={j} className="h-9 w-full animate-pulse rounded bg-muted" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
