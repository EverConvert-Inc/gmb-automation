"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label, Select, Textarea } from "@/components/ui/form";
import { formatRelativeDate } from "@/lib/utils";
import { ChevronDown, Plus, Star } from "lucide-react";
import { replayScan } from "@/app/clients/[slug]/locations/[locationId]/actions";

const GRID_SIZES = [3, 5, 7, 9, 11, 13] as const;
type GridSize = (typeof GRID_SIZES)[number];

type Keyword = { id: string; keyword: string; isPrimary: boolean };
type GridConfigOption = {
  id: string;
  name: string;
  size: number;
  radiusMiles: number;
  isDefault: boolean;
};
type ScanRow = {
  id: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
  status: string;
  triggeredBy: string;
  totalKeywords: number;
  totalPoints: number;
  gridConfigId: string;
};
type ActiveScan = {
  id: string;
  status: string;
  totalPoints: number;
  completedPoints: number;
};

type Props = {
  locationId: string;
  allKeywords: Keyword[];
  gridConfigs: GridConfigOption[];
  recentScans: ScanRow[];
  initialActiveScan: ActiveScan | null;
};

type GridMode = "default" | "existing" | "custom";

export function ScanManagementPanel({
  locationId,
  allKeywords,
  gridConfigs,
  recentScans,
  initialActiveScan,
}: Props) {
  const router = useRouter();

  const defaultGrid = useMemo(
    () => gridConfigs.find((g) => g.isDefault) ?? null,
    [gridConfigs],
  );
  const nonDefaultGrids = useMemo(
    () => gridConfigs.filter((g) => !g.isDefault),
    [gridConfigs],
  );
  const gridById = useMemo(() => {
    const map = new Map<string, GridConfigOption>();
    for (const g of gridConfigs) map.set(g.id, g);
    return map;
  }, [gridConfigs]);

  const [selectedKeywordIds, setSelectedKeywordIds] = useState<Set<string>>(
    () => new Set(allKeywords.map((k) => k.id)),
  );
  const [newKeywordsText, setNewKeywordsText] = useState("");
  const [gridMode, setGridMode] = useState<GridMode>(
    defaultGrid ? "default" : nonDefaultGrids.length > 0 ? "existing" : "custom",
  );
  const [existingGridId, setExistingGridId] = useState<string>(
    nonDefaultGrids[0]?.id ?? "",
  );
  const [customSize, setCustomSize] = useState<GridSize>(7);
  const [customRadius, setCustomRadius] = useState<number>(5);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeScan, setActiveScan] = useState<ActiveScan | null>(initialActiveScan);
  const [pendingRerunId, startRerun] = useTransition();
  const [toast, setToast] = useState<{ kind: "info" | "error"; message: string } | null>(
    null,
  );
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#scan-new") setFormOpen(true);
  }, []);

  const parsedNewKeywords = useMemo(
    () =>
      Array.from(
        new Set(
          newKeywordsText
            .split("\n")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        ),
      ),
    [newKeywordsText],
  );

  const selectedCount = selectedKeywordIds.size + parsedNewKeywords.length;
  const isActive =
    activeScan?.status === "running" || activeScan?.status === "queued";
  const submitDisabled = submitting || isActive || selectedCount === 0;

  useEffect(() => {
    if (!isActive || !activeScan) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/locations/${locationId}/scan`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          scan: { id: string; status: string } | null;
          completedPoints: number;
          points: unknown[];
        };
        if (cancelled || !data.scan) return;
        const total = data.points.length;
        if (data.scan.status === "completed" || data.scan.status === "errored") {
          setActiveScan(null);
          router.refresh();
          return;
        }
        setActiveScan({
          id: data.scan.id,
          status: data.scan.status,
          totalPoints: total,
          completedPoints: data.completedPoints,
        });
      } catch {
        // ignore transient failures
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isActive, activeScan, locationId, router]);

  function toggleKeyword(id: string) {
    setSelectedKeywordIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllKeywords(checked: boolean) {
    setSelectedKeywordIds(checked ? new Set(allKeywords.map((k) => k.id)) : new Set());
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setToast(null);

    if (selectedCount === 0) {
      setFormError("Select at least one keyword.");
      return;
    }
    if (gridMode === "existing" && !existingGridId) {
      setFormError("Pick a grid config or switch to default/custom.");
      return;
    }
    if (gridMode === "custom" && (!customRadius || customRadius <= 0)) {
      setFormError("Custom radius must be greater than 0.");
      return;
    }

    const body: Record<string, unknown> = {
      locationId,
      triggeredBy: "manual",
      keywordIds: Array.from(selectedKeywordIds),
    };
    if (parsedNewKeywords.length > 0) body.newKeywords = parsedNewKeywords;
    if (gridMode === "existing") body.gridConfigId = existingGridId;
    if (gridMode === "custom") {
      body.newGridConfig = { size: customSize, radiusMiles: customRadius };
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/scans/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        scanId?: string;
        totalPoints?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setActiveScan({
        id: data.scanId ?? "",
        status: "running",
        totalPoints: data.totalPoints ?? 0,
        completedPoints: 0,
      });
      setNewKeywordsText("");
      router.refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleRerun(scanId: string) {
    setToast(null);
    startRerun(async () => {
      const result = await replayScan(scanId);
      if (!result.ok) {
        setToast({ kind: "error", message: result.error });
        return;
      }
      if (result.usedDefaultGrid) {
        setToast({
          kind: "info",
          message: "Original grid no longer available; using location default.",
        });
      }
      setActiveScan({
        id: result.scanId,
        status: "running",
        totalPoints: result.totalPoints,
        completedPoints: 0,
      });
      router.refresh();
    });
  }

  return (
    <Card id="scan">
      <CardHeader>
        <CardTitle>Scan management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {isActive && activeScan && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            Scan in progress · {activeScan.completedPoints}/{activeScan.totalPoints}{" "}
            points complete · live updates above
          </div>
        )}

        {toast && (
          <div
            className={`rounded-md border p-3 text-sm ${
              toast.kind === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
          >
            {toast.message}
          </div>
        )}

        {!formOpen ? (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            disabled={isActive}
            className="flex w-full items-center justify-between rounded-md border border-dashed bg-muted/20 p-4 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <span className="font-medium">Run new scan</span>
              <span className="text-xs text-muted-foreground">
                {summarizeDefaults(allKeywords.length, defaultGrid)}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        ) : (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Run a scan
              </h3>
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setFormError(null);
                }}
                className="text-xs text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={submitForm} className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="mb-0">Keywords</Label>
                {allKeywords.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() =>
                      selectAllKeywords(selectedKeywordIds.size !== allKeywords.length)
                    }
                  >
                    {selectedKeywordIds.size === allKeywords.length
                      ? "Clear all"
                      : "Select all"}
                  </button>
                )}
              </div>
              {allKeywords.length === 0 ? (
                <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                  No saved keywords yet — add one or more below to run your first scan.
                </div>
              ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {allKeywords.map((kw) => (
                    <label
                      key={kw.id}
                      className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={selectedKeywordIds.has(kw.id)}
                        onChange={() => toggleKeyword(kw.id)}
                      />
                      <span className="flex-1 truncate">{kw.keyword}</span>
                      {kw.isPrimary && (
                        <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="newKeywords">Add new keywords</Label>
              <Textarea
                id="newKeywords"
                value={newKeywordsText}
                onChange={(e) => setNewKeywordsText(e.target.value)}
                placeholder={"family lawyer\ndivorce attorney near me"}
                rows={3}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                One per line. New keywords are saved to this location for future scans.
              </p>
            </div>

            <div>
              <Label className="mb-2">Grid configuration</Label>
              <div className="space-y-2">
                {defaultGrid && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="gridMode"
                      checked={gridMode === "default"}
                      onChange={() => setGridMode("default")}
                    />
                    <span>
                      Default ·{" "}
                      <span className="text-muted-foreground">
                        {defaultGrid.size}×{defaultGrid.size},{" "}
                        {Number(defaultGrid.radiusMiles)}mi
                      </span>
                    </span>
                  </label>
                )}

                {nonDefaultGrids.length > 0 && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="gridMode"
                        checked={gridMode === "existing"}
                        onChange={() => setGridMode("existing")}
                      />
                      <span>Use saved config</span>
                    </label>
                    {gridMode === "existing" && (
                      <Select
                        className="ml-6 max-w-xs"
                        value={existingGridId}
                        onChange={(e) => setExistingGridId(e.target.value)}
                      >
                        {nonDefaultGrids.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="gridMode"
                      checked={gridMode === "custom"}
                      onChange={() => setGridMode("custom")}
                    />
                    <span>Custom (one-off)</span>
                  </label>
                  {gridMode === "custom" && (
                    <div className="ml-6 grid max-w-md gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="customSize">Size</Label>
                        <Select
                          id="customSize"
                          value={customSize}
                          onChange={(e) =>
                            setCustomSize(Number(e.target.value) as GridSize)
                          }
                        >
                          {GRID_SIZES.map((s) => (
                            <option key={s} value={s}>
                              {s} × {s} ({s * s} pts)
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="customRadius">Radius (miles)</Label>
                        <Input
                          id="customRadius"
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={customRadius}
                          onChange={(e) => setCustomRadius(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <FormError>{formError}</FormError>

            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {selectedCount === 0
                  ? "Select at least one keyword."
                  : `${selectedCount} keyword${selectedCount === 1 ? "" : "s"} · ${gridPointEstimate(gridMode, defaultGrid, gridById.get(existingGridId), customSize)} points/keyword`}
              </div>
              <Button type="submit" disabled={submitDisabled}>
                {submitting
                  ? "Dispatching…"
                  : isActive
                    ? "Scan running…"
                    : "Run scan"}
              </Button>
            </div>
          </form>
          </section>
        )}

        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Scan history
          </h3>
          {recentScans.length === 0 ? (
            <div className="text-sm text-muted-foreground">No scans yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Keywords</th>
                    <th className="pb-2 pr-4 font-medium">Grid</th>
                    <th className="pb-2 pr-4 font-medium">Triggered</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {recentScans.map((s) => {
                    const grid = gridById.get(s.gridConfigId);
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="py-2 pr-4">{formatRelativeDate(s.startedAt)}</td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={
                              s.status === "completed"
                                ? "success"
                                : s.status === "errored"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {s.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">{s.totalKeywords}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {grid
                            ? `${grid.size}×${grid.size}, ${Number(grid.radiusMiles)}mi`
                            : "—"}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {s.triggeredBy}
                        </td>
                        <td className="py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pendingRerunId || isActive}
                            onClick={() => handleRerun(s.id)}
                          >
                            Rerun
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function gridPointEstimate(
  mode: GridMode,
  defaultGrid: GridConfigOption | null,
  existingGrid: GridConfigOption | undefined,
  customSize: GridSize,
): number {
  if (mode === "default" && defaultGrid) return defaultGrid.size * defaultGrid.size;
  if (mode === "existing" && existingGrid) return existingGrid.size * existingGrid.size;
  if (mode === "custom") return customSize * customSize;
  return 0;
}

function summarizeDefaults(
  keywordCount: number,
  defaultGrid: GridConfigOption | null,
): string {
  const kw = `${keywordCount} keyword${keywordCount === 1 ? "" : "s"}`;
  const grid = defaultGrid
    ? `${defaultGrid.size}×${defaultGrid.size}, ${Number(defaultGrid.radiusMiles)}mi`
    : "no default grid";
  return `${kw} · ${grid}`;
}
