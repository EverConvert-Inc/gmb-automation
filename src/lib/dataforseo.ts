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

export function findRankForPlaceId(
  result: SerpMapsResult,
  placeId: string,
): { rank: number | null; competitors: Array<{ placeId: string; name: string; rank: number }> } {
  const items = (result.items ?? []).filter(
    (i) => i.type === "maps_search" && typeof i.rank_absolute === "number",
  );
  let rank: number | null = null;
  for (const item of items) {
    if (item.place_id === placeId) {
      rank = item.rank_absolute ?? null;
      break;
    }
  }
  const competitors = items
    .filter((i) => i.place_id && i.place_id !== placeId)
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
