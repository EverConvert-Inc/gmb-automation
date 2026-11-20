"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AdminSelect } from "@/components/leads/admin-select";
import { CAMPAIGN_FIELDS, type Expected, type Standard } from "@/lib/ads-standards";
import { enumLabel } from "@/lib/google-ads-format";
import { cn } from "@/lib/utils";

const CHANNELS = ["SEARCH", "PERFORMANCE_MAX", "DISPLAY", "VIDEO", "SHOPPING", "DEMAND_GEN"];

type EnforcedState = Record<string, { on: boolean; value: string | boolean }>;

function initEnforced(expected: Expected): EnforcedState {
  const s: EnforcedState = {};
  for (const f of CAMPAIGN_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(expected, f.key);
    s[f.key] = {
      on: present,
      value: present ? expected[f.key] : f.type === "bool" ? true : (f.options?.[0]?.value ?? ""),
    };
  }
  return s;
}

function toExpected(state: EnforcedState): Expected {
  const e: Expected = {};
  for (const [key, v] of Object.entries(state)) if (v.on) e[key] = v.value;
  return e;
}

const btn = "rounded-md border px-3 py-1.5 text-sm font-medium";
const btnPrimary = "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-50";

function Editor({ standard, onDone }: { standard: Standard | null; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(standard?.name ?? "");
  const [enabled, setEnabled] = useState(standard?.enabled ?? true);
  const [channelType, setChannelType] = useState(standard?.match.channelType ?? "");
  const [nameContains, setNameContains] = useState(standard?.match.nameContains ?? "");
  const [enforced, setEnforced] = useState<EnforcedState>(initEnforced(standard?.campaignExpected ?? {}));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      enabled,
      match: {
        ...(channelType ? { channelType } : {}),
        ...(nameContains.trim() ? { nameContains: nameContains.trim() } : {}),
      },
      campaignExpected: toExpected(enforced),
      adGroupExpected: {},
    };
    try {
      const res = await fetch(standard ? `/api/ads/standards/${standard.id}` : "/api/ads/standards", {
        method: standard ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      onDone();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Search baseline"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex items-end gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            <span>Enabled</span>
          </label>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Applies to</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminSelect value={channelType} onChange={(e) => setChannelType(e.target.value)} className="h-9">
              <option value="">Any campaign type</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {enumLabel(c)}
                </option>
              ))}
            </AdminSelect>
            <input
              value={nameContains}
              onChange={(e) => setNameContains(e.target.value)}
              placeholder="Name contains… (optional)"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Enforced settings</div>
          <div className="divide-y rounded-md border">
            {CAMPAIGN_FIELDS.map((f) => {
              const st = enforced[f.key];
              return (
                <div key={f.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <label className="flex min-w-[12rem] items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={st.on}
                      onChange={(e) => setEnforced((p) => ({ ...p, [f.key]: { ...p[f.key], on: e.target.checked } }))}
                      className="h-4 w-4"
                    />
                    <span className={cn(!st.on && "text-muted-foreground")}>{f.label}</span>
                  </label>
                  {st.on &&
                    (f.type === "bool" ? (
                      <AdminSelect
                        value={String(st.value)}
                        onChange={(e) => setEnforced((p) => ({ ...p, [f.key]: { ...p[f.key], value: e.target.value === "true" } }))}
                        className="h-8 w-auto"
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </AdminSelect>
                    ) : (
                      <AdminSelect
                        value={String(st.value)}
                        onChange={(e) => setEnforced((p) => ({ ...p, [f.key]: { ...p[f.key], value: e.target.value } }))}
                        className="h-8 w-auto"
                      >
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </AdminSelect>
                    ))}
                </div>
              );
            })}
          </div>
        </div>

        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving || !name.trim()} className={btnPrimary}>
            {saving ? "Saving…" : standard ? "Save changes" : "Create standard"}
          </button>
          <button onClick={onDone} className={btn}>
            Cancel
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export function GoogleAdsStandardsManager({ standards }: { standards: Standard[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Standard | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(s: Standard) {
    if (!confirm(`Delete standard “${s.name}”?`)) return;
    setBusyId(s.id);
    try {
      await fetch(`/api/ads/standards/${s.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (editing) {
    return <Editor standard={editing === "new" ? null : editing} onDone={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setEditing("new")} className={btnPrimary}>
          New standard
        </button>
      </div>

      {standards.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No standards yet. Create one to start auditing campaign settings against it.
          </CardContent>
        </Card>
      ) : (
        standards.map((s) => {
          const enforcedCount = Object.keys(s.campaignExpected).length;
          const match = [
            s.match.channelType ? enumLabel(s.match.channelType) : "Any type",
            s.match.nameContains ? `name contains “${s.match.nameContains}”` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", s.enabled ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                    <span className="font-medium">{s.name}</span>
                    {!s.enabled && <span className="text-xs text-muted-foreground">disabled</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {match} · {enforcedCount} enforced setting{enforcedCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditing(s)} className={btn}>
                    Edit
                  </button>
                  <button onClick={() => remove(s)} disabled={busyId === s.id} className={cn(btn, "text-red-700 dark:text-red-400")}>
                    {busyId === s.id ? "…" : "Delete"}
                  </button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
