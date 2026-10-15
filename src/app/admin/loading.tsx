import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Covers every /admin route. Two reasons it is worth a file.
 *
 * A slow render now shows a skeleton instead of a blank page that looks
 * hung — /clients/[slug] has had one for this reason and is why its own
 * six-query fan-out never read as a problem.
 *
 * And it gives Next a prefetch boundary: with no loading.tsx, a dynamic
 * route has nothing for <Link> to prefetch, so every navigation starts from
 * cold.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8" aria-busy="true">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-muted" />
      </div>
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardHeader>
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-9 w-full animate-pulse rounded bg-muted" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
