"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { fuDone, fuPrimary } from "./firm-ui";

export type PickerCompany = {
  id: string;
  name: string | null;
  disabled: boolean;
  mappedTo: { firmId: string; firmName: string } | null;
};

type Availability = { kind: "here" } | { kind: "elsewhere"; firmName: string } | { kind: "disabled" } | { kind: "free" };

/** Whether a company can be added to this firm, and why not. */
export function availability(c: PickerCompany, firmId: string): Availability {
  if (c.mappedTo?.firmId === firmId) return { kind: "here" };
  if (c.mappedTo) return { kind: "elsewhere", firmName: c.mappedTo.firmName };
  if (c.disabled) return { kind: "disabled" };
  return { kind: "free" };
}

export function filterCompanies(list: readonly PickerCompany[], query: string): PickerCompany[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((c) => (c.name ?? "").toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
}

// Kept for the page's lifetime, so reopening the picker does not call CallRail again.
let sessionCache: PickerCompany[] | null = null;

/**
 * Lists the account's CallRail companies — only when opened — with search,
 * and adds the chosen one through the same onPick the paste box uses.
 */
export function CallRailCompanyPicker({
  firmId,
  onPick,
}: {
  firmId: string;
  onPick: (companyId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<PickerCompany[] | null>(sessionCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  async function load(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/callrail/companies${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { companies?: PickerCompany[]; error?: string };
      if (!res.ok || !body.companies) throw new Error(body.error ?? `HTTP ${res.status}`);
      sessionCache = body.companies;
      setCompanies(body.companies);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !companies && !loading) void load();
  }

  async function pick(id: string) {
    setAdding(id);
    const ok = await onPick(id);
    setAdding(null);
    if (ok) {
      // Reflect the new mapping without another CallRail call.
      const update = (list: PickerCompany[]) =>
        list.map((c) => (c.id === id ? { ...c, mappedTo: { firmId, firmName: "this firm" } } : c));
      sessionCache = sessionCache ? update(sessionCache) : sessionCache;
      setCompanies((prev) => (prev ? update(prev) : prev));
    }
  }

  const shown = useMemo(() => filterCompanies(companies ?? [], query), [companies, query]);

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={toggle} aria-expanded={open}>
        {open ? "Close list" : "Choose from CallRail"}
      </Button>

      {open && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search CallRail companies"
              placeholder="Search by name or id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
              autoComplete="off"
            />
          </div>

          {loading && <p className="text-sm text-muted-foreground">Loading companies from CallRail…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}{" "}
              <button type="button" className="underline" onClick={() => load()}>
                Retry
              </button>
            </p>
          )}

          {companies && !loading && (
            <>
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {shown.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">No companies match.</li>}
                {shown.map((c) => {
                  const a = availability(c, firmId);
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name ?? "Unnamed company"}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{c.id}</span>
                      </span>
                      {a.kind === "free" ? (
                        <Button
                          type="button"
                          size="sm"
                          className={fuPrimary}
                          disabled={adding !== null}
                          onClick={() => pick(c.id)}
                        >
                          {adding === c.id ? "Adding…" : "Add"}
                        </Button>
                      ) : (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-xs",
                            a.kind === "here" ? fuDone : "border text-muted-foreground",
                          )}
                        >
                          {a.kind === "here"
                            ? "This firm"
                            : a.kind === "elsewhere"
                              ? `Mapped to ${a.firmName}`
                              : "Disabled in CallRail"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => load(true)}>
                Reload from CallRail
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
