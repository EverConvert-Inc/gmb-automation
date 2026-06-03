"use client";

import { useEffect, useState } from "react";

type Payload = {
  spentUsd: number | null;
  sinceIso: string;
  asOfIso: string;
};

// Month-to-date spend against the SEO API (DataForSEO under the hood, but
// the operator-facing label is generic). Fetches once on mount with a
// silent retry path — failures degrade to "—" so a flaky billing call
// doesn't break the sidebar.
export function SeoApiSpendIndicator() {
  const [data, setData] = useState<Payload | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/seo-api-spend", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Payload;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setErrored(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const displayValue =
    errored || data === null || data.spentUsd === null
      ? "—"
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        }).format(data.spentUsd);

  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wider text-white/40">
        SEO API spend
      </span>
      <span
        className="text-xs font-medium tabular-nums text-white/80"
        title={
          data?.asOfIso
            ? `Month-to-date as of ${new Date(data.asOfIso).toLocaleString()}`
            : "Month-to-date"
        }
      >
        {displayValue}
        <span className="ml-1 text-[9px] uppercase text-white/40">MTD</span>
      </span>
    </div>
  );
}
