"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Account + campaign-status selects for the Google Ads Overview. Each writes
// its value to the page URL so the server component refetches; a value of
// "all" is dropped from the query string to keep it clean.
export function GoogleAdsOverviewFilters({
  accounts,
  account,
  status,
}: {
  accounts: Array<{ id: string; name: string }>;
  account: string;
  status: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function set(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete(key);
    else params.set(key, value);
    router.push(`?${params.toString()}`);
  }

  const selectClass =
    "rounded-md border bg-background px-2 py-1 text-xs text-foreground";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Account
        <select
          value={account}
          onChange={(e) => set("account", e.target.value)}
          className={selectClass}
        >
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Status
        <select
          value={status}
          onChange={(e) => set("status", e.target.value)}
          className={selectClass}
        >
          <option value="enabled">Enabled</option>
          <option value="paused">Paused</option>
          <option value="all">All</option>
        </select>
      </label>
    </div>
  );
}
