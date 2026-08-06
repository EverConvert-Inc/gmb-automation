"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormError, Input, Label, Select } from "@/components/ui/form";
import type { TagCategory } from "./ppc-callrail-tag-categories-card";

type Draft = { label: string; callrailTagName: string; rollup: "real" | "junk" };

function draftOf(c: TagCategory): Draft {
  return { label: c.label, callrailTagName: c.callrailTagName, rollup: c.rollup };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return a.label === b.label && a.callrailTagName === b.callrailTagName && a.rollup === b.rollup;
}

// Mirrors PpcCallrailTagCategoriesCard — see its comment for the rationale.
export function LsaCallrailTagCategoriesCard({
  clientId,
  initial,
}: {
  clientId: string;
  initial: TagCategory[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState<TagCategory[]>(
    [...initial].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initial.map((c) => [c.id, draftOf(c)])),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  const [newLabel, setNewLabel] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newRollup, setNewRollup] = useState<"real" | "junk">("real");
  const [addBusy, setAddBusy] = useState(false);

  const base = `/api/lsa/clients/${clientId}/tag-categories`;

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function saveRow(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`${base}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drafts[id]),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as TagCategory;
      setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeRow(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`${base}/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const other = index + dir;
    if (other < 0 || other >= categories.length) return;
    const a = categories[index];
    const b = categories[other];
    setError(null);
    setBusyId(a.id);
    try {
      const [resA, resB] = await Promise.all([
        fetch(`${base}/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: b.sortOrder }),
        }),
        fetch(`${base}/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: a.sortOrder }),
        }),
      ]);
      if (!resA.ok || !resB.ok) {
        throw new Error("Failed to reorder categories");
      }
      const updatedA = (await resA.json()) as TagCategory;
      const updatedB = (await resB.json()) as TagCategory;
      setCategories((prev) => {
        const next = prev.map((c) =>
          c.id === updatedA.id ? updatedA : c.id === updatedB.id ? updatedB : c,
        );
        return next.sort((x, y) => x.sortOrder - y.sortOrder);
      });
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAddBusy(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newLabel,
          callrailTagName: newTag,
          rollup: newRollup,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as TagCategory;
      setCategories((prev) => [...prev, created]);
      setDrafts((prev) => ({ ...prev, [created.id]: draftOf(created) }));
      setNewLabel("");
      setNewTag("");
      setNewRollup("real");
      startRefresh(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Call quality tag categories</CardTitle>
        <CardDescription>
          CallRail tags this client uses, and whether each counts as a
          &ldquo;real&rdquo; or &ldquo;junk&rdquo; call in the Ads
          Conversion Tracker x CallRail report.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {categories.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            No tag categories configured yet — the call quality report will
            show every call as unclassified until at least one is added.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c, index) => {
              const draft = drafts[c.id] ?? draftOf(c);
              const dirty = !draftsEqual(draft, draftOf(c));
              const busy = busyId === c.id;
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-1 rounded-full border bg-muted/30 py-1 pl-2 pr-1"
                >
                  <Input
                    aria-label="Label"
                    value={draft.label}
                    onChange={(e) =>
                      setDraft(c.id, { label: e.target.value })
                    }
                    size={Math.max(4, draft.label.length)}
                    className="h-6 w-auto min-w-0 border-0 bg-transparent px-1.5 text-xs shadow-none focus-visible:ring-1"
                  />
                  <Input
                    aria-label="CallRail tag name"
                    value={draft.callrailTagName}
                    onChange={(e) =>
                      setDraft(c.id, { callrailTagName: e.target.value })
                    }
                    size={Math.max(4, draft.callrailTagName.length)}
                    className="h-6 w-auto min-w-0 border-0 bg-transparent px-1.5 text-xs shadow-none focus-visible:ring-1"
                  />
                  <Select
                    aria-label="Rollup"
                    value={draft.rollup}
                    onChange={(e) =>
                      setDraft(c.id, {
                        rollup: e.target.value as "real" | "junk",
                      })
                    }
                    className="h-6 w-20 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
                  >
                    <option value="real">Real</option>
                    <option value="junk">Junk</option>
                  </Select>
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => move(index, -1)}
                      disabled={busy || index === 0}
                      aria-label={`Move ${c.label} up`}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => move(index, 1)}
                      disabled={busy || index === categories.length - 1}
                      aria-label={`Move ${c.label} down`}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => saveRow(c.id)}
                      disabled={busy || !dirty}
                    >
                      {dirty ? "Save" : "Saved"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => removeRow(c.id)}
                      disabled={busy}
                      aria-label={`Remove ${c.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <form
          onSubmit={add}
          className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_1fr_auto_auto]"
        >
          <div>
            <Label htmlFor="new-category-label">Label</Label>
            <Input
              id="new-category-label"
              required
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Signed"
            />
          </div>
          <div>
            <Label htmlFor="new-category-tag">CallRail tag name</Label>
            <Input
              id="new-category-tag"
              required
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Signed"
            />
          </div>
          <div>
            <Label htmlFor="new-category-rollup">Rollup</Label>
            <Select
              id="new-category-rollup"
              value={newRollup}
              onChange={(e) => setNewRollup(e.target.value as "real" | "junk")}
            >
              <option value="real">Real</option>
              <option value="junk">Junk</option>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={addBusy || !newLabel || !newTag}
            >
              {addBusy ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
        <FormError>{error}</FormError>
      </CardContent>
    </Card>
  );
}
