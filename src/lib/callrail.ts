// Thin wrapper around CallRail's v3 REST API. One agency-wide API key is
// stored as CALLRAIL_API_KEY; per-client mapping lives in ppc_clients
// (`callrailCompanyId` + `signedCaseTag`).

const BASE_URL = process.env.CALLRAIL_API_BASE ?? "https://api.callrail.com";

function authHeaders(): HeadersInit {
  const key = process.env.CALLRAIL_API_KEY;
  if (!key) throw new Error("CALLRAIL_API_KEY not set");
  return {
    Authorization: `Token token="${key}"`,
    "Content-Type": "application/json",
  };
}

type CallRailAccount = {
  id: string;
  name: string;
};

type CallRailCompany = {
  id: string;
  name: string;
  status: string;
};

type CallRailCall = {
  id: string;
  start_time: string;
  duration: number | null;
  tags: Array<{ id: number; name: string } | string> | null;
};

// CallRail's "account" is the agency. Most setups have one. We list and
// pick the first; if you ever have multiple, set CALLRAIL_ACCOUNT_ID to pin.
async function resolveAccountId(): Promise<string> {
  const pinned = process.env.CALLRAIL_ACCOUNT_ID;
  if (pinned) return pinned;
  const res = await fetch(`${BASE_URL}/v3/a.json`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`CallRail accounts fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { accounts?: CallRailAccount[] };
  const first = body.accounts?.[0];
  if (!first) throw new Error("No CallRail accounts visible with this API key");
  return first.id;
}

export async function listCompanies(): Promise<CallRailCompany[]> {
  const accountId = await resolveAccountId();
  const all: CallRailCompany[] = [];
  let page = 1;
  while (true) {
    const url = `${BASE_URL}/v3/a/${accountId}/companies.json?page=${page}&per_page=100`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`CallRail companies fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      companies?: CallRailCompany[];
      total_pages?: number;
    };
    for (const c of body.companies ?? []) all.push(c);
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }
  return all;
}

export type CallrailDailyTotals = {
  date: string; // YYYY-MM-DD
  totalCalls: number;
  signedCases: number;
};

// Walks every call in the window and groups by (day in UTC). Signed cases =
// count of calls that carry the configured tag (case-insensitive). We page
// through all results — CallRail caps per_page at 250.
export async function pullCallsForCompany(
  companyId: string,
  fromDate: string,
  toDate: string,
  signedTag: string,
): Promise<CallrailDailyTotals[]> {
  const accountId = await resolveAccountId();
  const calls: CallRailCall[] = [];
  let page = 1;
  while (true) {
    const url = new URL(
      `${BASE_URL}/v3/a/${accountId}/companies/${companyId}/calls.json`,
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "250");
    url.searchParams.set("start_date", fromDate);
    url.searchParams.set("end_date", toDate);
    url.searchParams.set("fields", "tags,duration");
    const res = await fetch(url.toString(), { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(
        `CallRail calls fetch failed: ${res.status} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as {
      calls?: CallRailCall[];
      total_pages?: number;
    };
    for (const c of body.calls ?? []) calls.push(c);
    if (!body.total_pages || page >= body.total_pages) break;
    page += 1;
  }

  const wantTag = signedTag.trim().toLowerCase();
  const byDate = new Map<string, CallrailDailyTotals>();
  for (const call of calls) {
    const date = call.start_time.slice(0, 10);
    const bucket = byDate.get(date) ?? {
      date,
      totalCalls: 0,
      signedCases: 0,
    };
    bucket.totalCalls += 1;
    const tagNames = (call.tags ?? []).map((t) =>
      typeof t === "string" ? t : t.name,
    );
    if (tagNames.some((t) => t.toLowerCase() === wantTag)) {
      bucket.signedCases += 1;
    }
    byDate.set(date, bucket);
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
