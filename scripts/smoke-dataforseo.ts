/**
 * Local smoke check for DataForSEO auth + task_post/task_get round-trip.
 * Reads DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD from env (.env.local).
 *
 *   npx tsx --env-file=.env.local scripts/smoke-dataforseo.ts
 *
 * Note: this calls /task_get/advanced after a short wait, bypassing the
 * webhook postback flow used in production. It exists to confirm credentials,
 * billing status, and that the SERP response shape matches what
 * findRankForPlaceId() expects.
 */

import { findRankForPlaceId } from "../src/lib/dataforseo";

const login = process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_PASSWORD;
if (!login || !password) {
  console.error("DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set");
  process.exit(1);
}
const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");

async function userData() {
  const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
    headers: { Authorization: auth },
  });
  console.log("user_data:", res.status);
  console.log(JSON.stringify(await res.json(), null, 2).slice(0, 500));
}

async function postTask() {
  const res = await fetch(
    "https://api.dataforseo.com/v3/serp/google/maps/task_post",
    {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          keyword: "personal injury lawyer",
          language_code: "en",
          location_coordinate: "33.7589,-84.388,13",
          tag: "smoke-test",
        },
      ]),
    },
  );
  const json = await res.json();
  console.log("task_post:", res.status, "->", json.tasks?.[0]?.id);
  return json.tasks?.[0]?.id as string | undefined;
}

async function fetchAdvanced(taskId: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `https://api.dataforseo.com/v3/serp/google/maps/task_get/advanced/${taskId}`,
      { headers: { Authorization: auth } },
    );
    const json = await res.json();
    const status = json.tasks?.[0]?.status_code;
    console.log(`task_get attempt ${attempt + 1}: status_code=${status}`);
    if (status === 20000 && json.tasks?.[0]?.result) {
      const result = json.tasks[0].result[0];
      console.log("items:", result.items?.length ?? 0);
      const first = result.items?.find((i: { rank_absolute?: number }) => i.rank_absolute);
      console.log("top result place_id:", first?.place_id, first?.title);
      const probe = findRankForPlaceId(result, first?.place_id ?? "");
      console.log("findRankForPlaceId echo:", probe.rank, "competitors:", probe.competitors.length);
      return;
    }
  }
  console.error("task did not resolve in time");
}

async function main() {
  await userData();
  const id = await postTask();
  if (!id) return;
  await fetchAdvanced(id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
