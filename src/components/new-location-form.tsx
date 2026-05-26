"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError, Input, Label, Select, Textarea } from "@/components/ui/form";
import { MapPin } from "lucide-react";

type PlaceCandidate = {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
};

const GRID_SIZES = [3, 5, 7, 9, 11, 13] as const;

export function NewLocationForm({ clientId, clientSlug }: { clientId: string; clientSlug: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlaceCandidate[]>([]);
  const [picked, setPicked] = useState<PlaceCandidate | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [gridSize, setGridSize] = useState<number>(11);
  const [radiusMiles, setRadiusMiles] = useState<number>(5);
  const [connectGbpAfter, setConnectGbpAfter] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/places/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { results: PlaceCandidate[] };
      setResults(json.results);
      if (json.results.length === 0) setError("No places matched. Try a more specific query.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function pick(candidate: PlaceCandidate) {
    setPicked(candidate);
    if (!displayName) setDisplayName(candidate.name);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) {
      setError("Pick a place first.");
      return;
    }
    const keywords = keywordsText
      .split("\n")
      // Normalize curly apostrophes to straight so a spreadsheet paste
      // doesn't fork "workers' compensation lawyer" into two distinct
      // keywords from the database's POV.
      .map((s) => s.trim().replace(/[‘’]/g, "'"))
      .filter(Boolean);
    if (keywords.length === 0) {
      setError("Add at least one keyword.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          name: displayName || picked.name,
          address: picked.formattedAddress,
          placeId: picked.placeId,
          lat: picked.lat,
          lng: picked.lng,
          keywords,
          gridSize,
          radiusMiles,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json().catch(() => null)) as { id?: string } | null;
      // Hand off directly to Google's OAuth flow when requested — the
      // callback already redirects back to /clients/<slug> with a banner.
      // Use a full-page navigation since /api/oauth/google/start is a
      // server route that 302s out of the Next app.
      if (created?.id && connectGbpAfter) {
        window.location.assign(
          `/api/oauth/google/start?locationId=${created.id}`,
        );
        return;
      }
      const redirectTo = created?.id
        ? `/clients/${clientSlug}?location=${created.id}&just_added=1`
        : `/clients/${clientSlug}`;
      router.push(redirectTo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <ol className="list-decimal space-y-1 rounded-md border bg-muted/20 p-4 pl-7 text-xs text-muted-foreground">
        <li>Search for the business by name or address.</li>
        <li>Pick the matching result from Google.</li>
        <li>Add at least one keyword, then Create location.</li>
      </ol>
      <div>
        <Label htmlFor="q">Search Google Places</Label>
        <div className="flex gap-2">
          <Input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Smith Law Atlanta or 123 Peachtree St NE, Atlanta, GA"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={search} disabled={searching || !query.trim()}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
        {!picked && results.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Run a search first, then pick a place to fill in the rest of the form.
          </p>
        )}
      </div>

      {results.length > 0 && (
        <div className="space-y-1">
          <Label>Pick a place</Label>
          <ul className="divide-y rounded-md border">
            {results.map((r) => (
              <li key={r.placeId}>
                <button
                  type="button"
                  className={`flex w-full items-start gap-3 p-3 text-left text-sm hover:bg-muted/40 ${
                    picked?.placeId === r.placeId ? "bg-accent" : ""
                  }`}
                  onClick={() => pick(r)}
                >
                  <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.formattedAddress}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {picked && (
        <div className="space-y-4 rounded-md border bg-muted/20 p-4">
          <div>
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={picked.name}
            />
            <p className="mt-1 text-xs text-muted-foreground">How this location appears in dashboards.</p>
          </div>

          <div>
            <Label htmlFor="kw">Keywords</Label>
            <Textarea
              id="kw"
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              placeholder={"e.g.\npersonal injury lawyer\ncar accident attorney"}
              rows={4}
              className="placeholder:italic"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              One per line. The first becomes the primary keyword.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="gs">Grid size</Label>
              <Select id="gs" value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))}>
                {GRID_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} × {s} ({s * s} points)
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rm">Radius (miles)</Label>
              <Input
                id="rm"
                type="number"
                min={1}
                step={0.5}
                value={radiusMiles}
                onChange={(e) => setRadiusMiles(Number(e.target.value))}
              />
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-md border bg-background p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={connectGbpAfter}
              onChange={(e) => setConnectGbpAfter(e.target.checked)}
            />
            <span className="flex-1">
              <span className="font-medium">
                Connect Google Business Profile after creating
              </span>
              <span className="ml-1 text-xs text-muted-foreground">
                (recommended)
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                We&apos;ll send you to Google to grant access so reviews can
                sync. You can also do this later from the client page.
              </span>
            </span>
          </label>
        </div>
      )}

      <FormError>{error}</FormError>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !picked}>
          {busy ? "Creating…" : "Create location"}
        </Button>
      </div>
    </form>
  );
}
