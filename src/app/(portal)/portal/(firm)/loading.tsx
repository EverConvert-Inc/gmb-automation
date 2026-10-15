/** Shown inside the header while the month's leads load. */
export default function PortalLeadsLoading() {
  return (
    <div className="space-y-6 sm:space-y-8" role="status" aria-label="Loading leads">
      <div className="space-y-2">
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-48 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border bg-card sm:h-24" />
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-xl border bg-card">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b px-5 py-5 last:border-b-0">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            <div className="hidden h-5 w-20 animate-pulse rounded-full bg-muted sm:block" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
