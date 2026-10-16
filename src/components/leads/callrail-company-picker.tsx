"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { fuDone, fuFocusRing } from "./firm-ui";

export type PickerCompany = {
  id: string;
  name: string | null;
  disabled: boolean;
  mappedTo: { firmId: string; firmName: string } | null;
};

type Availability = { kind: "here" } | { kind: "elsewhere"; firmName: string } | { kind: "disabled" } | { kind: "free" };

/** Whether a company can be mapped to this firm, and why not. */
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

/** A pasted CallRail company id, e.g. COM8a3f… */
export function looksLikeCompanyId(text: string): boolean {
  return /^COM[0-9a-z]{6,}$/i.test(text.trim());
}

export type PickerOption =
  | { kind: "company"; company: PickerCompany; pickable: boolean; note: string | null }
  | { kind: "pasted"; id: string; pickable: true };

/**
 * What the dropdown lists for a query. A pasted id that is IN the list shows
 * as that company (taken or not); a pasted id that is NOT in the list — or
 * typed while the list failed to load — shows as "use this id", so a CallRail
 * outage never blocks mapping a company.
 */
export function pickerOptions(list: readonly PickerCompany[] | null, query: string, firmId: string): PickerOption[] {
  const q = query.trim();
  const companies = list ? filterCompanies(list, q) : [];
  const options: PickerOption[] = companies.map((c) => {
    const a = availability(c, firmId);
    return {
      kind: "company",
      company: c,
      pickable: a.kind === "free",
      note: a.kind === "here" ? "This firm" : a.kind === "elsewhere" ? `Taken by ${a.firmName}` : a.kind === "disabled" ? "Disabled in CallRail" : null,
    };
  });
  if (looksLikeCompanyId(q) && !list?.some((c) => c.id.toLowerCase() === q.toLowerCase())) {
    options.unshift({ kind: "pasted", id: q, pickable: true });
  }
  return options;
}

const CLIENT_TIMEOUT_MS = 20_000; // the server gives up at 15s; this only catches a dead network
// The list, once loaded, for the page's lifetime: refocusing does not call again.
let sessionCache: PickerCompany[] | null = null;

/**
 * One field for the CallRail company: type to search the account by name,
 * or paste a COM… id. Opens on focus/click; the list is fetched on the FIRST
 * focus only. Picking maps the company in one click, shows a confirmation,
 * and closes the list.
 */
export function CallRailCompanyField({
  firmId,
  onPick,
}: {
  firmId: string;
  onPick: (companyId: string) => Promise<boolean>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [list, setList] = useState<PickerCompany[] | null>(sessionCache);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ id: string; name: string | null } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => pickerOptions(list, query, firmId), [list, query, firmId]);
  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  async function load(refresh = false) {
    setLoading(true);
    setLoadError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/admin/callrail/companies${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { companies?: PickerCompany[]; error?: string };
      if (!res.ok || !body.companies) throw new Error(body.error ?? `HTTP ${res.status}`);
      sessionCache = body.companies;
      setList(body.companies);
    } catch (err) {
      setLoadError(controller.signal.aborted ? "CallRail is taking too long." : (err as Error).message);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  function openList() {
    setOpen(true);
    setConfirmed(null);
    // First focus only: never on page load, never again once loaded.
    if (!list && !loading && !loadError) void load();
  }

  async function pick(id: string, name: string | null) {
    if (adding) return;
    setAdding(id);
    const ok = await onPick(id);
    setAdding(null);
    if (!ok) return; // the card shows the error; the list stays open
    const mark = (l: PickerCompany[]) =>
      l.map((c) => (c.id === id ? { ...c, mappedTo: { firmId, firmName: "this firm" } } : c));
    sessionCache = sessionCache ? mark(sessionCache) : null;
    setList((l) => (l ? mark(l) : l));
    setConfirmed({ id, name });
    setQuery("");
    setOpen(false);
  }

  function choose(o: PickerOption | undefined) {
    if (!o || !o.pickable) return;
    if (o.kind === "pasted") void pick(o.id, null);
    else void pick(o.company.id, o.company.name);
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div
      ref={wrapRef}
      className="relative space-y-2"
      onBlur={(e) => {
        // Close only when focus really moves elsewhere (not on a press inside the list).
        if (open && e.relatedTarget && !wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        CallRail company
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? optionId(active) : undefined}
          autoComplete="off"
          placeholder="Search CallRail companies, or paste a COM… id"
          value={query}
          disabled={adding !== null}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            setConfirmed(null);
            if (!open) openList();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) openList();
              setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(options[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={cn(
            "h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60",
            fuFocusRing,
          )}
        />
      </div>

      {confirmed && !open && (
        <p role="status" className={cn("flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm", fuDone)}>
          <Check aria-hidden className="h-4 w-4" />
          Mapped {confirmed.name ? `${confirmed.name} (${confirmed.id})` : confirmed.id}
        </p>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-11 z-20 overflow-hidden rounded-lg border bg-card shadow-lg">
          <ul id={listId} role="listbox" aria-label="CallRail companies" className="max-h-72 overflow-y-auto py-1">
            {options.map((o, i) => {
              const id = o.kind === "pasted" ? o.id : o.company.id;
              const name = o.kind === "pasted" ? `Use ${o.id}` : (o.company.name ?? "Unnamed company");
              const note = o.kind === "pasted" ? "Pasted id" : o.note;
              return (
                <li
                  key={`${o.kind}-${id}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={!o.pickable}
                  // Keep focus in the field, so pressing a row never closes the list first.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    "flex items-center justify-between gap-3 px-3 py-2 text-sm",
                    o.pickable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                    i === active && o.pickable && "bg-muted",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{name}</span>
                    {o.kind === "company" && <span className="block font-mono text-xs text-muted-foreground">{o.company.id}</span>}
                  </span>
                  {adding === id ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Mapping…</span>
                  ) : note ? (
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs", note === "This firm" ? fuDone : "border text-muted-foreground")}>
                      {note}
                    </span>
                  ) : null}
                </li>
              );
            })}
            {loading && <li className="px-3 py-2 text-sm text-muted-foreground">Loading companies from CallRail…</li>}
            {loadError && (
              <li className="px-3 py-2 text-sm text-destructive">
                {loadError} You can still paste a COM… id.{" "}
                <button type="button" className="underline" onMouseDown={(e) => e.preventDefault()} onClick={() => load()}>
                  Retry
                </button>
              </li>
            )}
            {!loading && !loadError && list && options.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No companies match.</li>
            )}
          </ul>
          {list && (
            <div className="border-t px-3 py-1.5">
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => load(true)}
              >
                Reload from CallRail
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
