"use client";

import { ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

// Account + campaign-status selects for the Google Ads Overview. Each writes
// its value to the page URL so the server component refetches; a value of
// "all" is dropped from the query string to keep it clean.
//
// Dropdowns use the project's canonical styled-select technique (see
// AdminSelect): a native <select> with the browser arrow removed
// (appearance-none) and a ChevronDown absolutely positioned and vertically
// centred, with right padding so the value never runs under it. Don't swap in
// a raw <select> — its native arrow looks out of place next to every other
// dropdown in the app.
function Dropdown({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <span className="relative inline-flex">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none rounded-md border bg-background py-1 pl-2.5 pr-7 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
      </span>
    </label>
  );
}

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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dropdown label="Account" value={account} onChange={(v) => set("account", v)}>
        <option value="all">All accounts</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Dropdown>
      <Dropdown label="Status" value={status} onChange={(v) => set("status", v)}>
        <option value="enabled">Enabled</option>
        <option value="paused">Paused</option>
        <option value="all">All</option>
      </Dropdown>
    </div>
  );
}
