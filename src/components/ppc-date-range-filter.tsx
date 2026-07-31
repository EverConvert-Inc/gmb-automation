"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import {
  daysAgoIsoEastern,
  firstOfMonthIsoEastern,
  firstOfPreviousMonthIsoEastern,
  lastDayOfPreviousMonthIsoEastern,
  yesterdayIsoEastern,
} from "@/lib/date-utils";

type Preset = {
  key: string;
  label: string;
  // Returns [from, to] in YYYY-MM-DD.
  range: () => [string, string];
};

function presets(): Preset[] {
  return [
    {
      key: "last7",
      label: "Last 7 days",
      // The Google Ads + CallRail crons only sync yesterday's metrics
      // (today is still in flight), so every preset caps `to` at
      // yesterday — without that cap, every delta on the report skews
      // more negative than reality by comparing N-1 days of real data
      // against a full N-day prior period.
      range: () => [daysAgoIsoEastern(7), yesterdayIsoEastern()],
    },
    {
      key: "mtd",
      label: "This month",
      range: () => {
        const from = firstOfMonthIsoEastern();
        const to = yesterdayIsoEastern();
        // Day-1-of-month edge case: yesterday is in the previous month,
        // so clamp `to` forward to `from`. The query returns no rows and
        // the report shows an empty state, which is accurate — this
        // month has no synced data yet. ISO YYYY-MM-DD strings sort
        // lexicographically the same as chronologically, so a plain
        // string compare is exact here.
        return [from, to < from ? from : to];
      },
    },
    {
      key: "lastMonth",
      label: "Last month",
      range: () => [
        firstOfPreviousMonthIsoEastern(),
        lastDayOfPreviousMonthIsoEastern(),
      ],
    },
    {
      key: "last90",
      label: "Last 90 days",
      range: () => [daysAgoIsoEastern(90), yesterdayIsoEastern()],
    },
  ];
}

// Renders preset chips + custom from/to inputs. Updates the page URL's
// from/to params so the server component refetches.
export function PpcDateRangeFilter({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  useEffect(() => setLocalFrom(from), [from]);
  useEffect(() => setLocalTo(to), [to]);

  const presetList = useMemo(presets, []);
  const activePresetKey = useMemo(() => {
    for (const p of presetList) {
      const [pf, pt] = p.range();
      if (pf === from && pt === to) return p.key;
    }
    return "custom";
  }, [from, to, presetList]);

  function setRange(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", nextFrom);
    params.set("to", nextTo);
    router.push(`?${params.toString()}`);
  }

  // Real navigable href, not just an onClick — a plain button+onClick only
  // works once React has hydrated and attached the handler, so a click
  // landing before that (very plausible on first page load) is silently
  // dropped with no error or feedback. A real <a href> (via Link) works
  // immediately via native browser navigation and upgrades to a client-side
  // transition once hydrated.
  function presetHref(nextFrom: string, nextTo: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", nextFrom);
    params.set("to", nextTo);
    return `?${params.toString()}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
      <div className="inline-flex flex-wrap gap-1">
        {presetList.map((p) => {
          const [f, t] = p.range();
          return (
            <Link
              key={p.key}
              href={presetHref(f, t)}
              className={
                activePresetKey === p.key
                  ? "rounded-full border border-brand bg-brand/10 px-2.5 py-1 font-medium text-foreground"
                  : "rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }
            >
              {p.label}
            </Link>
          );
        })}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        <input
          type="date"
          value={localFrom}
          onChange={(e) => setLocalFrom(e.target.value)}
          onBlur={() => {
            if (localFrom && localFrom !== from) setRange(localFrom, localTo);
          }}
          className="rounded-md border bg-background px-2 py-1"
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="date"
          value={localTo}
          onChange={(e) => setLocalTo(e.target.value)}
          onBlur={() => {
            if (localTo && localTo !== to) setRange(localFrom, localTo);
          }}
          className="rounded-md border bg-background px-2 py-1"
        />
      </div>
    </div>
  );
}
