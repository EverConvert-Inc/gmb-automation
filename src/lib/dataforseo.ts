const TASK_POST_URL = "https://api.dataforseo.com/v3/serp/google/maps/task_post";
const TASK_GET_URL = "https://api.dataforseo.com/v3/serp/google/maps/task_get/advanced";

export type DataForSeoTaskTag = {
  scanId: string;
  scanPointId: string;
  keywordId: string;
  gridX: number;
  gridY: number;
};

export type DataForSeoTask = {
  keyword: string;
  lat: number;
  lng: number;
  zoom?: number;
  tag: DataForSeoTaskTag;
  postbackUrl: string;
};

export type SerpMapsResultItem = {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  place_id?: string;
  title?: string;
  rating?: { value?: number; votes_count?: number };
  cid?: string;
};

export type SerpMapsResult = {
  items?: SerpMapsResultItem[];
};

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set");
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

export function encodeTag(tag: DataForSeoTaskTag): string {
  return [tag.scanId, tag.scanPointId, tag.keywordId, tag.gridX, tag.gridY].join("|");
}

export function decodeTag(encoded: string): DataForSeoTaskTag | null {
  const parts = encoded.split("|");
  if (parts.length !== 5) return null;
  const [scanId, scanPointId, keywordId, gx, gy] = parts;
  const gridX = Number(gx);
  const gridY = Number(gy);
  if (Number.isNaN(gridX) || Number.isNaN(gridY)) return null;
  return { scanId, scanPointId, keywordId, gridX, gridY };
}

export async function postTasks(tasks: DataForSeoTask[]): Promise<void> {
  if (tasks.length === 0) return;
  const body = tasks.map((t) => ({
    keyword: t.keyword,
    language_code: "en",
    location_coordinate: `${t.lat},${t.lng},${t.zoom ?? 13}`,
    // The heat map labels any rank > 20 as "20+", so there's no point
    // pulling positions 21-100 from DataForSEO. Cap depth at 20 to keep
    // response payloads small and (on metered plans) trim API cost.
    depth: 20,
    tag: encodeTag(t.tag),
    postback_url: t.postbackUrl,
    postback_data: "advanced",
  }));
  const res = await fetch(TASK_POST_URL, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`DataForSEO task_post failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { status_code: number; status_message: string };
  if (json.status_code !== 20000) {
    throw new Error(`DataForSEO task_post returned ${json.status_code}: ${json.status_message}`);
  }
}

export async function fetchTaskResult(taskId: string): Promise<SerpMapsResult | null> {
  const res = await fetch(`${TASK_GET_URL}/${taskId}`, {
    method: "GET",
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    tasks?: Array<{ result?: SerpMapsResult[] }>;
  };
  return json.tasks?.[0]?.result?.[0] ?? null;
}

function normalizePlaceId(id: string | undefined | null): string {
  if (!id) return "";
  return id.replace(/^places\//, "").trim();
}

export function findRankForPlaceId(
  result: SerpMapsResult,
  placeId: string,
): { rank: number | null; competitors: Array<{ placeId: string; name: string; rank: number }> } {
  const target = normalizePlaceId(placeId);
  const items = (result.items ?? []).filter(
    (i) => typeof i.rank_absolute === "number" && i.place_id,
  );

  let rank: number | null = null;
  let matched: SerpMapsResultItem | null = null;
  for (const item of items) {
    if (normalizePlaceId(item.place_id) === target) {
      rank = item.rank_absolute ?? null;
      matched = item;
      break;
    }
  }

  if (!matched) {
    console.log("[postback] no placeId match", {
      target,
      itemCount: result.items?.length ?? 0,
      rankableCount: items.length,
      itemTypes: Array.from(new Set((result.items ?? []).map((i) => i.type))),
      samplePlaceIds: items.slice(0, 5).map((i) => i.place_id),
    });
  }

  const competitors = items
    .filter((i) => normalizePlaceId(i.place_id) !== target)
    .slice(0, 5)
    .map((i) => ({
      placeId: i.place_id!,
      name: i.title ?? "",
      rank: i.rank_absolute ?? 0,
    }));
  return { rank, competitors };
}

export async function dispatchWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      try {
        const value = await fn(items[idx]);
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export function estimateScanCost(gridSize: number, keywordCount: number): number {
  return gridSize * gridSize * keywordCount * 0.0006;
}

const ORGANIC_LIVE_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/live/regular";

export type SerpOrganicItem = {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  url?: string;
  domain?: string;
  title?: string;
};

type OrganicLiveResponse = {
  status_code: number;
  status_message?: string;
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    result?: Array<{ items?: SerpOrganicItem[] }>;
  }>;
};

export type GeoTarget =
  | { kind: "code"; code: number }
  | { kind: "coord"; lat: number; lng: number };

const ORGANIC_CALL_TIMEOUT_MS = 45_000;

export async function pullOrganicSerp(
  keyword: string,
  geo?: GeoTarget,
): Promise<SerpOrganicItem[] | null> {
  const payload: Record<string, unknown> = {
    keyword,
    language_code: "en",
    device: "desktop",
    depth: 100,
  };
  if (geo?.kind === "coord") {
    // DataForSEO accepts "lat,lng" — this places the simulated search at
    // the exact GPS point, which is the closest thing to "physically in
    // that city" they offer. More precise than the city-level
    // location_code, which collapses all suburbs to one metro code.
    payload.location_coordinate = `${geo.lat},${geo.lng}`;
  } else if (geo?.kind === "code") {
    payload.location_code = geo.code;
  }

  // Per-call timeout. Without this a single hung DataForSEO call can block
  // long enough to push the route past its serverless maxDuration and
  // surface as a 504 to the user. Failing fast lets the per-keyword error
  // handler record the failure and the rest of the scan continues.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORGANIC_CALL_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(ORGANIC_LIVE_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify([payload]),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `DataForSEO organic SERP failed: ${res.status} ${await res.text()}`,
      );
    }
    const json = (await res.json()) as OrganicLiveResponse;
    if (json.status_code !== 20000) {
      throw new Error(
        `DataForSEO organic SERP returned ${json.status_code}: ${json.status_message ?? "unknown"}`,
      );
    }
    const ms = Date.now() - t0;
    if (ms > 10_000) {
      console.log(
        `[pullOrganicSerp] slow ${ms}ms keyword="${keyword.slice(0, 40)}" geo=${geo?.kind ?? "none"}`,
      );
    }
    return json.tasks?.[0]?.result?.[0]?.items ?? null;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      throw new Error(
        `DataForSEO organic SERP timed out after ${ORGANIC_CALL_TIMEOUT_MS}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function findOrganicRankForDomain(
  items: SerpOrganicItem[] | null,
  hostname: string,
): { rank: number | null; url: string | null } {
  if (!items || !hostname) return { rank: null, url: null };
  for (const item of items) {
    if (item.type !== "organic") continue;
    if (typeof item.rank_absolute !== "number" || !item.url) continue;
    const itemHost = extractHostname(item.url);
    if (itemHost && itemHost === hostname) {
      return { rank: item.rank_absolute, url: item.url };
    }
  }
  return { rank: null, url: null };
}

// DataForSEO Google Ads location codes for metros where Big 5 clients operate.
// Add more cities here as needed.
export const METRO_LOCATIONS: Record<string, number> = {
  // Georgia (Atlanta metro)
  Atlanta: 1015116,
  Cumming: 1015116,
  Marietta: 1015116,
  Norcross: 1015116,
  Alpharetta: 1015116,
  Lawrenceville: 1015116,
  Decatur: 1015116,
  Kennesaw: 1015116,
  // Florida (Miami metro)
  Miami: 1015042,
  "Coral Gables": 1015042,
  // South Carolina (Charleston metro)
  Charleston: 1017942,
  Beaufort: 1017942,
  Bluffton: 1017942,
  // North Carolina (Raleigh metro)
  Raleigh: 1015150,
  Durham: 1015150,
  Fayetteville: 1015150,
};

export function getLocationCodeForCity(
  city: string | null | undefined,
): number | undefined {
  if (!city) return undefined;
  return METRO_LOCATIONS[city];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Find a city from METRO_LOCATIONS in the keyword and return both the
// detected city + the keyword with the city removed (the "bare" version).
// Multi-word cities are tried first so "Coral Gables" wins over a hypothetical
// shorter "Coral". Returns { city: null, bareKeyword: keyword } if no city
// is found.
export function detectCity(keyword: string): {
  city: string | null;
  bareKeyword: string;
} {
  const cities = Object.keys(METRO_LOCATIONS).sort(
    (a, b) => b.length - a.length,
  );
  for (const city of cities) {
    const re = new RegExp(`\\b${escapeRegExp(city)}\\b`, "i");
    if (re.test(keyword)) {
      return { city, bareKeyword: stripCityFromKeyword(keyword, city) };
    }
  }
  return { city: null, bareKeyword: keyword };
}

// Remove a known city name from a keyword + clean up dangling prepositions.
// Handles patterns like "in Atlanta" / "de Miami" / "en Atlanta" at the end,
// city at the start, city at the end, or anywhere as a fallback.
export function stripCityFromKeyword(keyword: string, city: string): string {
  const c = escapeRegExp(city);
  const patterns = [
    new RegExp(`\\s+(?:in|en|de|of)\\s+${c}\\s*$`, "i"),
    new RegExp(`^${c}\\s+`, "i"),
    new RegExp(`\\s+${c}\\s*$`, "i"),
    new RegExp(`\\s*${c}\\s*`, "i"),
  ];
  for (const p of patterns) {
    if (p.test(keyword)) {
      return keyword.replace(p, " ").replace(/\s+/g, " ").trim();
    }
  }
  return keyword;
}

// --- Monthly API-spend lookup ------------------------------------------------

const TRANSACTIONS_LIST_URL =
  "https://api.dataforseo.com/v3/appendix/transactions/list";

// Format a Date as DataForSEO's expected "YYYY-MM-DD HH:MM:SS +00:00".
function fmtDataForSeoDatetime(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} +00:00`;
}

// Sum the absolute value of all spend transactions in the current calendar
// month (UTC). Returns null on any error so the indicator can render a
// graceful "—" without breaking the sidebar.
//
// Defensive about response shape — DataForSEO's transactions response is
// nested deeper than most endpoints (`tasks[].result[].items[]` in some
// docs, or `tasks[].result[]` directly). We walk both shapes and pick out
// anything that looks like a numeric amount + a recognisable
// debit/credit indicator.
export async function getMonthlyDataForSeoSpendUsd(): Promise<number | null> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0),
  );

  try {
    const res = await fetch(TRANSACTIONS_LIST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify([
        {
          datetime_from: fmtDataForSeoDatetime(monthStart),
          datetime_to: fmtDataForSeoDatetime(now),
          limit: 1000,
        },
      ]),
      // Don't let a slow billing call hang the sidebar render.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;

    // Walk the nested response, collect every leaf object that looks like
    // a transaction, sum the spend.
    const txns: Array<{ amount: number; type?: string }> = [];
    function walk(node: unknown) {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (typeof obj.amount === "number") {
          txns.push({
            amount: obj.amount,
            type: typeof obj.type === "string" ? obj.type : undefined,
          });
        }
        for (const v of Object.values(obj)) walk(v);
      }
    }
    walk(data);

    let spent = 0;
    for (const t of txns) {
      // DataForSEO reports spend as negative `amount` and refills as
      // positive. Some endpoints flip the sign — fall back to the `type`
      // field when present (operation types like "task_post", "money_add").
      if (t.type === "money_add" || t.type === "refill") continue;
      if (t.amount < 0) {
        spent += Math.abs(t.amount);
      } else if (t.type && /task|charge|spend|debit/i.test(t.type)) {
        spent += t.amount;
      }
    }
    return Math.round(spent * 100) / 100;
  } catch {
    return null;
  }
}
