"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminSelect } from "@/components/leads/admin-select";
import { RECON_SOURCES, type ReconMapping, type ReconSource } from "@/lib/ads-reconciliation";
import { cn } from "@/lib/utils";

type ActionOption = { id: string; name: string; conversions: number };

const btn = "rounded-md border px-2.5 py-1 text-xs font-medium";
const btnPrimary =
  "rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground disabled:opacity-50";

function Editor({
  clientId,
  mapping,
  actions,
  actionsError,
  onDone,
}: {
  clientId: string;
  mapping: ReconMapping | null;
  actions: ActionOption[];
  actionsError: string | null;
  onDone: (changed: boolean) => void;
}) {
  const [label, setLabel] = useState(mapping?.label ?? "");
  const [actionId, setActionId] = useState(mapping?.adsConversionActionId ?? "");
  const [source, setSource] = useState<ReconSource>(mapping?.source ?? "callrail_first_time_calls");
  const [enabled, setEnabled] = useState(mapping?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If editing a mapping whose action isn't in the live list (removed, or
  // outside the 30-day window), keep it selectable so we don't silently drop it.
  const options = [...actions];
  if (mapping && actionId && !options.some((a) => a.id === actionId)) {
    options.unshift({ id: actionId, name: mapping.adsConversionActionName || actionId, conversions: 0 });
  }

  function pickAction(id: string) {
    setActionId(id);
    const name = options.find((a) => a.id === id)?.name ?? "";
    if (!label.trim() && name) setLabel(name);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const name = options.find((a) => a.id === actionId)?.name ?? "";
    const body = {
      label: label.trim(),
      adsConversionActionId: actionId,
      adsConversionActionName: name,
      source,
      enabled,
    };
    try {
      const res = await fetch(
        mapping
          ? `/api/ads/reconciliation/mappings/${mapping.id}`
          : "/api/ads/reconciliation/mappings",
        {
          method: mapping ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mapping ? body : { ...body, ppcClientId: clientId }),
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Row label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. First Time Phone Call"
            className="h-8 w-full rounded-md border bg-background px-2.5 text-sm"
          />
        </label>
        <label className="flex items-end gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          <span>Enabled</span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Google Ads conversion action</span>
          <AdminSelect value={actionId} onChange={(e) => pickAction(e.target.value)} className="h-8">
            <option value="">Select an action…</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.conversions} in 30d)
              </option>
            ))}
          </AdminSelect>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Compare against</span>
          <AdminSelect value={source} onChange={(e) => setSource(e.target.value as ReconSource)} className="h-8">
            {RECON_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </AdminSelect>
        </label>
      </div>

      {actionsError && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t load this account&apos;s conversion actions ({actionsError}). You can still type a label and save,
          but pick the action again once it loads.
        </p>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving || !label.trim() || !actionId} className={btnPrimary}>
          {saving ? "Saving…" : mapping ? "Save" : "Add mapping"}
        </button>
        <button onClick={() => onDone(false)} className={btn}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ReconciliationMappingsManager({
  clientId,
  onChanged,
}: {
  clientId: string;
  onChanged?: () => void;
}) {
  const [mappings, setMappings] = useState<ReconMapping[] | null>(null);
  const [actions, setActions] = useState<ActionOption[]>([]);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReconMapping | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadMappings = useCallback(async () => {
    try {
      const res = await fetch(`/api/ads/reconciliation/mappings?clientId=${encodeURIComponent(clientId)}`);
      const json = (await res.json()) as { mappings?: ReconMapping[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load mappings");
      setMappings(json.mappings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMappings([]);
    }
  }, [clientId]);

  useEffect(() => {
    void loadMappings();
    void (async () => {
      try {
        const res = await fetch(`/api/ads/reconciliation/actions?clientId=${encodeURIComponent(clientId)}`);
        const json = (await res.json()) as { actions?: ActionOption[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to load conversion actions");
        setActions(json.actions ?? []);
      } catch (e) {
        setActionsError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [clientId, loadMappings]);

  async function doneEditing(changed: boolean) {
    setEditing(null);
    if (changed) {
      await loadMappings();
      onChanged?.();
    }
  }

  async function remove(m: ReconMapping) {
    if (!confirm(`Delete mapping “${m.label}”?`)) return;
    setBusyId(m.id);
    try {
      await fetch(`/api/ads/reconciliation/mappings/${m.id}`, { method: "DELETE" });
      await loadMappings();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}

      {editing ? (
        <Editor
          clientId={clientId}
          mapping={editing === "new" ? null : editing}
          actions={actions}
          actionsError={actionsError}
          onDone={doneEditing}
        />
      ) : (
        <>
          {mappings === null ? (
            <p className="text-xs text-muted-foreground">Loading mappings…</p>
          ) : mappings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No mappings yet for this account.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {mappings.map((m) => {
                const sourceLabel = RECON_SOURCES.find((s) => s.value === m.source)?.label ?? m.source;
                return (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full", m.enabled ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                        <span className="font-medium">{m.label}</span>
                        {!m.enabled && <span className="text-muted-foreground">disabled</span>}
                      </span>
                      <div className="mt-0.5 text-muted-foreground">
                        {m.adsConversionActionName || m.adsConversionActionId} → {sourceLabel}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing(m)} className={btn}>
                        Edit
                      </button>
                      <button
                        onClick={() => remove(m)}
                        disabled={busyId === m.id}
                        className={cn(btn, "text-red-700 dark:text-red-400")}
                      >
                        {busyId === m.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={() => setEditing("new")} className={btnPrimary}>
            Add mapping
          </button>
        </>
      )}
    </div>
  );
}
