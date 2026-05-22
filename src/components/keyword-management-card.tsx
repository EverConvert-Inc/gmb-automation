"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, MapPin, RefreshCw, Trash2 } from "lucide-react";
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

type Banner = {
  kind: "info" | "error" | "success";
  message: string;
  link?: { href: string; label: string };
};

export function KeywordManagementCard({
  clientId,
  clientSlug,
}: {
  clientId: string;
  clientSlug: string;
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
      setTargetUrl("");
      setGeoCity("");
      setBanner({
        kind: "success",
        message: geo.formatted
          ? `Added — searches from ${geo.formatted}`
          : "Added (national-only).",
      });
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
      const ok = body.completed ?? 0;
      const total = body.totalKeywords ?? 0;
      const err = body.errored ?? 0;
      if (total === 0) {
        setBanner({
          kind: "info",
          message: "No keywords to scan — add one above first.",
        });
      } else {
        const parts: string[] = [
          `Scanned ${ok} of ${total} keyword${total === 1 ? "" : "s"}`,
        ];
        if (err > 0) parts.push(`${err} errored`);
        setBanner({
          kind: ok > 0 ? "success" : "error",
          message: parts.join(" · "),
          link:
            ok > 0
              ? { href: `/clients/${clientSlug}`, label: "View rankings" }
              : undefined,
        });
      }
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
                ? "flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                : banner.kind === "success"
                  ? "flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
                  : "flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"
            }
          >
            <span>{banner.message}</span>
            {banner.link && (
              <a
                href={banner.link.href}
                className="font-medium underline-offset-2 hover:underline"
              >
                {banner.link.label} →
              </a>
            )}
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
                      <span className="text-xs italic">national</span>
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
