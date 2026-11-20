// Placeholder for Google Ads workspace sections still being built, so the
// sub-nav is complete and nothing 404s while each view lands.
export function GoogleAdsWorkspaceStub({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <header>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Google Ads</div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
      </header>
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm font-medium">In progress</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
