"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Label } from "@/components/ui/form";
import { AdminSelect } from "@/components/leads/admin-select";
import { formatMonthKey } from "@/lib/leads/admin-dates";

export function AdminLeadsFilters({
  firms,
  months,
  monthKey,
  firmFilter,
}: {
  firms: { id: string; name: string; isActive: boolean }[];
  months: string[];
  monthKey: string;
  /** "" = all firms, "unassigned" = the queue slot, otherwise a firm id. */
  firmFilter: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`/admin/leads?${next.toString()}`));
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-56">
        <Label htmlFor="lead-month">Month (Eastern)</Label>
        <AdminSelect
          id="lead-month"
          value={monthKey}
          onChange={(e) => setParam("month", e.target.value)}
          disabled={pending}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonthKey(m)}
            </option>
          ))}
        </AdminSelect>
      </div>
      <div className="sm:w-64">
        <Label htmlFor="lead-firm">Firm</Label>
        <AdminSelect
          id="lead-firm"
          value={firmFilter}
          onChange={(e) => setParam("firm", e.target.value)}
          disabled={pending}
        >
          <option value="">All firms</option>
          <option value="unassigned">Unassigned</option>
          {firms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </AdminSelect>
      </div>
    </div>
  );
}
