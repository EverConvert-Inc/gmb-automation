"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, Input, Label, Select } from "@/components/ui/form";

export type TrackedKeywordRow = {
  id: string;
  clientId: string;
  keyword: string;
  targetUrl: string;
  geoCity: string | null;
  geoLocationCode: number | null;
  isActive: boolean;
};

type Banner = { kind: "info" | "error" | "success"; message: string };

export function KeywordManagementCard({
  clientId,
  cities,
}: {
  clientId: string;
  cities: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<TrackedKeywordRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [geoCity, setGeoCity] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
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
    setBanner(null);
    setAdding(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          targetUrl: targetUrl.trim(),
          geoCity: geoCity || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setKeyword("");
      setTargetUrl("");
      setGeoCity("");
      setBanner({ kind: "success", message: "Keyword added." });
      await refreshList(showInactive);
    } catch (err) {
      setBanner({ kind: "error", message: (err as Error).message });
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(row: TrackedKeywordRow) {
    setBanner(null);
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
      setBanner({ kind: "error", message: (err as Error).message });
    }
  }

  async function deleteRow(row: TrackedKeywordRow) {
    if (!confirm(`Stop tracking "${row.keyword}"? History is preserved.`)) return;
    setBanner(null);
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
      setBanner({ kind: "error", message: (err as Error).message });
    }
  }

  async function scanNow() {
    setBanner(null);
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
      const parts: string[] = [];
      parts.push(`${body.completed ?? 0} of ${body.totalKeywords ?? 0} keywords scanned`);
      if (body.errored && body.errored > 0) parts.push(`${body.errored} errored`);
      setBanner({ kind: "success", message: parts.join(" · ") });
      startRefresh(() => router.refresh());
    } catch (err) {
      setBanner({ kind: "error", message: (err as Error).message });
    } finally {
      setScanning(false);
    }
  }

  const activeRows = rows.filter((r) => r.isActive);
  const inactiveCount = rows.length - activeRows.length;

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
        {banner && (
          <div
            className={
              banner.kind === "error"
                ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                : banner.kind === "success"
                  ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
                  : "rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"
            }
          >
            {banner.message}
          </div>
        )}

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
            <Label htmlFor="city">Geo city</Label>
            <Select
              id="city"
              value={geoCity}
              onChange={(e) => setGeoCity(e.target.value)}
            >
              <option value="">National only</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={adding}>
            {adding ? "Adding…" : "Add keyword"}
          </Button>
        </form>
        <FormError>{null}</FormError>

        <div className="overflow-hidden rounded-md border">
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
              {rows.map((r) => (
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
                    {r.geoCity ?? <span className="text-xs italic">national</span>}
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
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
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
