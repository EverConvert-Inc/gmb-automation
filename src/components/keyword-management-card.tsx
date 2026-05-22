"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, MapPin, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";

export type TrackedKeywordRow = {
  id: string;
  clientId: string;
  keyword: string;
  targetUrl: string;
  geoCity: string | null;
  geoLocationCode: number | null;
  geoLat: string | null;
  geoLng: string | null;
  geoFormatted: string | null;
  isActive: boolean;
};

export function KeywordManagementCard({
  clientId,
  clientSlug,
  suggestedTargetUrl,
}: {
  clientId: string;
  clientSlug: string;
  suggestedTargetUrl?: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<TrackedKeywordRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState(suggestedTargetUrl ?? "");
  const [geoCity, setGeoCity] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKeyword, setEditKeyword] = useState("");
  const [editTargetUrl, setEditTargetUrl] = useState("");
  const [editGeoCity, setEditGeoCity] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"newest" | "keyword-asc" | "keyword-desc" | "city">(
    "newest",
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    total: number;
    done: number;
    errors: Array<{ line: string; err: string }>;
  } | null>(null);
  const [, startRefresh] = useTransition();

  async function refreshList(includeInactive: boolean) {
    const qs = includeInactive ? "?includeInactive=1" : "";
    const res = await fetch(`/api/clients/${clientId}/keywords${qs}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { keywords: TrackedKeywordRow[] };
    setRows(data.keywords);
    setLoaded(true);
  }

  useEffect(() => {
    refreshList(showInactive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      let geo: {
        city: string | null;
        lat: number | null;
        lng: number | null;
        formatted: string | null;
      } = { city: null, lat: null, lng: null, formatted: null };
      const cityInput = geoCity.trim();
      if (cityInput) {
        const geoRes = await fetch(
          `/api/places/search?q=${encodeURIComponent(cityInput)}`,
        );
        if (!geoRes.ok) {
          throw new Error(`Couldn't geocode "${cityInput}"`);
        }
        const geoBody = (await geoRes.json()) as {
          results?: Array<{ name?: string; formattedAddress?: string; lat: number; lng: number }>;
        };
        const first = geoBody.results?.[0];
        if (!first) {
          throw new Error(`No location found for "${cityInput}"`);
        }
        geo = {
          city: cityInput,
          lat: first.lat,
          lng: first.lng,
          formatted: first.formattedAddress ?? null,
        };
      }

      const res = await fetch(`/api/clients/${clientId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          targetUrl: targetUrl.trim(),
          geoCity: geo.city,
          geoLat: geo.lat,
          geoLng: geo.lng,
          geoFormatted: geo.formatted,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setKeyword("");
      // Re-prefill so the next keyword inherits the same suggested URL.
      setTargetUrl(suggestedTargetUrl ?? "");
      setGeoCity("");
      toast.success(
        geo.formatted
          ? `Added — searches from ${geo.formatted}`
          : "Added (national-only).",
      );
      await refreshList(showInactive);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function bulkAdd() {
    // Parse: one keyword per line. Each line: keyword, target_url, city
    // Separator can be tab or comma (tab wins so URLs with commas survive
    // a spreadsheet paste). Empty lines + lines starting with `#` skipped.
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    if (lines.length === 0) {
      toast.error("No keywords to add.");
      return;
    }

    type Row = { keyword: string; targetUrl: string; geoCity: string; raw: string };
    const parsed: Row[] = [];
    const parseErrors: Array<{ line: string; err: string }> = [];
    for (const raw of lines) {
      const sep = raw.includes("\t") ? "\t" : ",";
      const parts = raw.split(sep).map((s) => s.trim());
      if (parts.length < 3) {
        parseErrors.push({
          line: raw,
          err: `expected "keyword${sep === "\t" ? "<TAB>" : ","}target_url${sep === "\t" ? "<TAB>" : ","}city", got ${parts.length} field${parts.length === 1 ? "" : "s"}`,
        });
        continue;
      }
      const [keywordRaw, targetUrl, ...cityParts] = parts;
      const geoCity = cityParts.join(sep);
      if (!keywordRaw || !targetUrl || !geoCity) {
        parseErrors.push({ line: raw, err: "missing keyword / url / city" });
        continue;
      }
      // Normalize curly apostrophes to straight — keeps dedupe consistent.
      const keywordVal = keywordRaw.replace(/[‘’]/g, "'");
      parsed.push({ keyword: keywordVal, targetUrl, geoCity, raw });
    }

    setBulkSubmitting(true);
    setBulkProgress({
      total: parsed.length,
      done: 0,
      errors: [...parseErrors],
    });

    let okCount = 0;
    const errs: Array<{ line: string; err: string }> = [...parseErrors];
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      try {
        const geoRes = await fetch(
          `/api/places/search?q=${encodeURIComponent(row.geoCity)}`,
        );
        if (!geoRes.ok) throw new Error(`geocode failed (${geoRes.status})`);
        const geoBody = (await geoRes.json()) as {
          results?: Array<{ formattedAddress?: string; lat: number; lng: number }>;
        };
        const first = geoBody.results?.[0];
        if (!first) throw new Error(`no geocode result for "${row.geoCity}"`);
        const res = await fetch(`/api/clients/${clientId}/keywords`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyword: row.keyword,
            targetUrl: row.targetUrl,
            geoCity: row.geoCity,
            geoLat: first.lat,
            geoLng: first.lng,
            geoFormatted: first.formattedAddress ?? null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        okCount++;
      } catch (err) {
        errs.push({ line: row.raw, err: (err as Error).message });
      }
      setBulkProgress({ total: parsed.length, done: i + 1, errors: errs });
    }

    setBulkSubmitting(false);
    const summary =
      `${okCount} of ${parsed.length} added` +
      (errs.length > 0 ? ` · ${errs.length} failed` : "");
    if (okCount > 0) {
      toast.success(summary);
      setBulkText("");
      await refreshList(showInactive);
    } else {
      toast.error(summary);
    }
  }

  function startEdit(row: TrackedKeywordRow) {
    setEditingId(row.id);
    setEditKeyword(row.keyword);
    setEditTargetUrl(row.targetUrl);
    setEditGeoCity(row.geoCity ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditKeyword("");
    setEditTargetUrl("");
    setEditGeoCity("");
  }

  async function saveEdit(row: TrackedKeywordRow) {
    setEditSaving(true);
    try {
      // Only re-geocode if the city actually changed — saves a Places call
      // when the user is only fixing the keyword text or target URL.
      const cityChanged = editGeoCity.trim() !== (row.geoCity ?? "").trim();
      let geo: { lat: number | null; lng: number | null; formatted: string | null } = {
        lat: null,
        lng: null,
        formatted: null,
      };
      if (cityChanged && editGeoCity.trim()) {
        const geoRes = await fetch(
          `/api/places/search?q=${encodeURIComponent(editGeoCity.trim())}`,
        );
        if (!geoRes.ok) throw new Error(`Couldn't geocode "${editGeoCity}"`);
        const geoBody = (await geoRes.json()) as {
          results?: Array<{ formattedAddress?: string; lat: number; lng: number }>;
        };
        const first = geoBody.results?.[0];
        if (!first) throw new Error(`No location found for "${editGeoCity}"`);
        geo = {
          lat: first.lat,
          lng: first.lng,
          formatted: first.formattedAddress ?? null,
        };
      }

      const payload: Record<string, unknown> = {};
      if (editKeyword.trim() !== row.keyword) payload.keyword = editKeyword.trim();
      if (editTargetUrl.trim() !== row.targetUrl) payload.targetUrl = editTargetUrl.trim();
      if (cityChanged) {
        payload.geoCity = editGeoCity.trim() || row.geoCity;
        if (geo.lat != null) {
          payload.geoLat = geo.lat;
          payload.geoLng = geo.lng;
          payload.geoFormatted = geo.formatted;
        }
      }

      if (Object.keys(payload).length === 0) {
        cancelEdit();
        return;
      }

      const res = await fetch(
        `/api/clients/${clientId}/keywords/${row.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      cancelEdit();
      await refreshList(showInactive);
      toast.success("Keyword updated.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(row: TrackedKeywordRow) {
    try {
      const res = await fetch(
        `/api/clients/${clientId}/keywords/${row.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !row.isActive }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshList(showInactive);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function deleteRow(row: TrackedKeywordRow) {
    if (!confirm(`Stop tracking "${row.keyword}"? History is preserved.`)) return;
    try {
      const res = await fetch(
        `/api/clients/${clientId}/keywords/${row.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshList(showInactive);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function scanNow() {
    setScanning(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/serp-scan`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        completed?: number;
        errored?: number;
        totalKeywords?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const ok = body.completed ?? 0;
      const total = body.totalKeywords ?? 0;
      const err = body.errored ?? 0;
      if (total === 0) {
        toast.info("No keywords to scan — add one above first.");
      } else {
        const parts: string[] = [
          `Scanned ${ok} of ${total} keyword${total === 1 ? "" : "s"}`,
        ];
        if (err > 0) parts.push(`${err} errored`);
        const summary = parts.join(" · ");
        if (ok > 0) {
          toast.success(summary, {
            action: {
              label: "View rankings →",
              onClick: () => router.push(`/clients/${clientSlug}`),
            },
          });
        } else {
          toast.error(summary);
        }
      }
      startRefresh(() => router.refresh());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setScanning(false);
    }
  }

  const activeRows = rows.filter((r) => r.isActive);
  const inactiveCount = rows.length - activeRows.length;

  // Filter + sort the visible rows. Search matches keyword text, target URL,
  // and city — covers the common "find all the Atlanta rows" use case.
  const q = searchQuery.trim().toLowerCase();
  const filteredRows = q
    ? rows.filter((r) =>
        [r.keyword, r.targetUrl, r.geoCity ?? ""].some((field) =>
          field.toLowerCase().includes(q),
        ),
      )
    : rows;
  const sortedRows = [...filteredRows].sort((a, b) => {
    switch (sortKey) {
      case "keyword-asc":
        return a.keyword.localeCompare(b.keyword);
      case "keyword-desc":
        return b.keyword.localeCompare(a.keyword);
      case "city":
        return (a.geoCity ?? "").localeCompare(b.geoCity ?? "");
      case "newest":
      default:
        // Rows already arrive desc-by-createdAt from the API.
        return 0;
    }
  });

  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand" />
            Tracked keywords
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={scanNow}
            disabled={scanning || activeRows.length === 0}
          >
            {scanning ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">

        <form
          onSubmit={addKeyword}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end"
        >
          <div>
            <Label htmlFor="kw">Keyword</Label>
            <Input
              id="kw"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="atlanta workers compensation lawyer"
              required
            />
          </div>
          <div>
            <Label htmlFor="url">Target URL</Label>
            <Input
              id="url"
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com/atlanta/workers-comp/"
              required
            />
          </div>
          <div>
            <Label htmlFor="city">Search from</Label>
            <Input
              id="city"
              value={geoCity}
              onChange={(e) => setGeoCity(e.target.value)}
              placeholder="Cumming, GA"
              required
            />
          </div>
          <Button type="submit" disabled={adding}>
            {adding ? "Adding…" : "Add keyword"}
          </Button>
        </form>

        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setBulkOpen((v) => !v)}
            className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {bulkOpen ? "Hide bulk add" : "Bulk add from list →"}
          </button>
        </div>

        {bulkOpen && (
          <div className="space-y-2 rounded-md border bg-muted/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="bulk-textarea">Paste keywords (one per line)</Label>
                <p className="text-[11px] text-muted-foreground">
                  Format:{" "}
                  <code className="rounded bg-muted px-1">
                    keyword, target_url, city
                  </code>{" "}
                  (or tab-separated). Lines starting with{" "}
                  <code className="rounded bg-muted px-1">#</code> are skipped.
                </p>
              </div>
            </div>
            <textarea
              id="bulk-textarea"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              spellCheck={false}
              className="w-full rounded-md border bg-background p-2 font-mono text-xs"
              placeholder={`Atlanta Car Accident Lawyer, https://example.com/atlanta/car-accident-lawyer/, Atlanta GA
Cumming Workers' Compensation Lawyer, https://example.com/cumming/workers-comp/, Cumming GA`}
              disabled={bulkSubmitting}
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                onClick={bulkAdd}
                disabled={bulkSubmitting || !bulkText.trim()}
              >
                {bulkSubmitting
                  ? bulkProgress
                    ? `Adding ${bulkProgress.done}/${bulkProgress.total}…`
                    : "Adding…"
                  : "Add all"}
              </Button>
              {bulkProgress && !bulkSubmitting && (
                <span className="text-xs text-muted-foreground">
                  Last run: {bulkProgress.done - bulkProgress.errors.length}/
                  {bulkProgress.total} added
                </span>
              )}
            </div>
            {bulkProgress && bulkProgress.errors.length > 0 && (
              <ul className="space-y-0.5 text-[11px] text-amber-700">
                {bulkProgress.errors.map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-medium">✗</span>
                    <span className="flex-1">
                      <code className="break-all">{e.line}</code> — {e.err}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search keyword, URL, or city…"
              className="h-8 max-w-xs"
            />
            <select
              value={sortKey}
              onChange={(e) =>
                setSortKey(e.target.value as typeof sortKey)
              }
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="newest">Newest first</option>
              <option value="keyword-asc">Keyword A → Z</option>
              <option value="keyword-desc">Keyword Z → A</option>
              <option value="city">Group by city</option>
            </select>
            <span className="text-muted-foreground">
              {sortedRows.length} of {rows.length}
              {searchQuery && sortedRows.length !== rows.length
                ? " match"
                : ""}
            </span>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Keyword</th>
                <th className="px-3 py-2 font-medium">Target URL</th>
                <th className="px-3 py-2 font-medium">Geo</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {loaded && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                    No tracked keywords yet. Add one above.
                  </td>
                </tr>
              )}
              {sortedRows.map((r) => {
                if (editingId === r.id) {
                  return (
                    <tr key={r.id} className="border-b bg-muted/10 last:border-0">
                      <td className="px-3 py-2">
                        <Input
                          value={editKeyword}
                          onChange={(e) => setEditKeyword(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="url"
                          value={editTargetUrl}
                          onChange={(e) => setEditTargetUrl(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={editGeoCity}
                          onChange={(e) => setEditGeoCity(e.target.value)}
                          placeholder="Cumming, GA"
                          className="h-8 text-sm"
                        />
                        {r.geoFormatted && editGeoCity === (r.geoCity ?? "") && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            currently: {r.geoFormatted}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2" colSpan={2}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => saveEdit(r)}
                            disabled={editSaving}
                          >
                            {editSaving ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            disabled={editSaving}
                          >
                            Cancel
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{r.keyword}</td>
                    <td
                      className="px-3 py-2 text-muted-foreground"
                      title={r.targetUrl}
                    >
                      <span className="block max-w-[28ch] truncate">
                        {r.targetUrl.replace(/^https?:\/\//, "")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.geoCity ? (
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-1 text-foreground">
                            <MapPin className="h-3 w-3" />
                            {r.geoCity}
                          </div>
                          {r.geoFormatted && (
                            <div
                              className="text-[10px] leading-tight"
                              title={
                                r.geoLat && r.geoLng
                                  ? `Search from ${r.geoLat}, ${r.geoLng}`
                                  : undefined
                              }
                            >
                              {r.geoFormatted}
                            </div>
                          )}
                          {r.geoLat && r.geoLng && (
                            <div className="text-[10px] leading-tight tabular-nums opacity-60">
                              {Number(r.geoLat).toFixed(4)},{" "}
                              {Number(r.geoLng).toFixed(4)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs italic">no geo</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.isActive ? (
                        <span className="text-xs uppercase tracking-wide text-green-700">
                          active
                        </span>
                      ) : (
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          paused
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(r)}
                          aria-label="Edit"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(r)}
                        >
                          {r.isActive ? "Pause" : "Resume"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteRow(r)}
                          aria-label="Delete"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(inactiveCount > 0 || showInactive) && (
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show paused keywords
            {!showInactive && inactiveCount > 0 && ` (${inactiveCount})`}
          </label>
        )}
      </CardContent>
    </Card>
  );
}
