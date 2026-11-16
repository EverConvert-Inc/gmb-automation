// Shown the instant a client is clicked, while the server looks the client
// up. Without it the browser stays on the overview with no feedback until
// the whole client page (including its live Google Ads queries) is ready.
export default function AdsDashboardClientLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-8 w-72 rounded bg-muted" />
      </div>
      <div className="flex gap-2 border-b pb-px">
        <div className="h-9 w-36 rounded-t bg-muted" />
        <div className="h-9 w-28 rounded-t bg-muted/60" />
        <div className="h-9 w-28 rounded-t bg-muted/60" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-lg bg-muted/60" />
        ))}
      </div>
      <div className="h-96 rounded-lg bg-muted/40" />
    </div>
  );
}
