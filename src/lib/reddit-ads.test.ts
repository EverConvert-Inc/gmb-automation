import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRedditAuthorizeUrl,
  exchangeRedditCode,
  listMyBusinesses,
  parseRateLimit,
  rateLimitClock,
  refreshRedditAccessToken,
  runAdAccountReport,
  spendMicrosToDollars,
  toRedditReportHour,
} from "./reddit-ads";

const UA = "web:everconvert-gmb-automation:1.0 (by /u/test)";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("reddit-ads", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sleeps: number[];

  beforeEach(() => {
    process.env.REDDIT_ADS_USER_AGENT = UA;
    process.env.REDDIT_ADS_APP_ID = "app-id";
    process.env.REDDIT_ADS_APP_SECRET = "app-secret";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sleeps = [];
    vi.spyOn(rateLimitClock, "sleep").mockImplementation(async (ms: number) => {
      sleeps.push(ms);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.REDDIT_ADS_USER_AGENT;
    delete process.env.REDDIT_ADS_APP_ID;
    delete process.env.REDDIT_ADS_APP_SECRET;
  });

  it("builds a permanent, adsread-only authorize URL", () => {
    const url = new URL(
      buildRedditAuthorizeUrl({ appId: "app-id", redirectUri: "https://x.test/cb", state: "s.sig" }),
    );
    expect(url.origin + url.pathname).toBe("https://www.reddit.com/api/v1/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "app-id",
      response_type: "code",
      state: "s.sig",
      redirect_uri: "https://x.test/cb",
      duration: "permanent",
      scope: "adsread",
    });
  });

  it("exchanges a code with Basic auth and the custom User-Agent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 86400, scope: "adsread" }),
    );
    const tokens = await exchangeRedditCode({ code: "c", redirectUri: "https://x.test/cb" });
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 86400, scope: "adsread" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.reddit.com/api/v1/access_token");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("app-id:app-secret").toString("base64")}`);
    expect(init.headers["User-Agent"]).toBe(UA);
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code",
      code: "c",
      redirect_uri: "https://x.test/cb",
    });
  });

  it("treats an HTTP 200 token response carrying {error} as a failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }));
    await expect(refreshRedditAccessToken("rt")).rejects.toThrow(/invalid_grant/);
  });

  it("refuses to run without a custom User-Agent", async () => {
    delete process.env.REDDIT_ADS_USER_AGENT;
    await expect(refreshRedditAccessToken("rt")).rejects.toThrow(/REDDIT_ADS_USER_AGENT/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows pagination.next_url verbatim until it runs out", async () => {
    const next = "https://ads-api.reddit.com/api/v3/me/businesses?page.token=opaque123";
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "b1", name: "One" }], pagination: { next_url: next } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "b2", name: "Two" }], pagination: { next_url: null } }));
    const { items, pages } = await listMyBusinesses("tok");
    expect(items.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(pages).toBe(2);
    expect(fetchMock.mock.calls[1][0]).toBe(next);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer tok");
  });

  it("won't send the bearer token to a next_url on another host", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [], pagination: { next_url: "https://evil.example/steal" } }),
    );
    await expect(listMyBusinesses("tok")).rejects.toThrow(/Refusing/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off on 429 for the RateLimit header's reset seconds, then retries", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { RateLimit: '"reporting";r=0;t=7' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { metrics: [{ date: "2026-10-20", spend: 12_340_000 }] } }));
    const { items } = await runAdAccountReport("tok", "a2_x", {
      breakdowns: ["DATE"],
      fields: ["SPEND"],
      startsAt: "2026-10-20T04:00:00Z",
      endsAt: "2026-10-21T04:00:00Z",
      timeZoneId: "America/New_York",
    });
    expect(sleeps).toEqual([7000]);
    expect(items).toEqual([{ date: "2026-10-20", spend: 12_340_000 }]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      data: {
        breakdowns: ["DATE"],
        fields: ["SPEND"],
        starts_at: "2026-10-20T04:00:00Z",
        ends_at: "2026-10-21T04:00:00Z",
        time_zone_id: "America/New_York",
      },
    });
  });

  it("gives up after repeated 429s instead of looping forever", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, { status: 429 }));
    await expect(listMyBusinesses("tok")).rejects.toThrow(/HTTP 429/);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(sleeps).toEqual([2000, 4000, 8000, 16000]);
  });

  it("parses both the combined and split RateLimit header forms", () => {
    expect(parseRateLimit(new Headers({ RateLimit: '"default";r=3;t=40' }))).toEqual({
      remaining: 3,
      resetSeconds: 40,
    });
    expect(
      parseRateLimit(new Headers({ "RateLimit-Remaining": "0", "RateLimit-Reset": "12" })),
    ).toEqual({ remaining: 0, resetSeconds: 12 });
    expect(parseRateLimit(new Headers({ "Retry-After": "5" }))).toEqual({
      remaining: null,
      resetSeconds: 5,
    });
  });

  it("converts micros and formats hour-granular report bounds", () => {
    expect(spendMicrosToDollars(12_345_678)).toBeCloseTo(12.345678);
    expect(spendMicrosToDollars(null)).toBe(0);
    expect(toRedditReportHour(new Date("2026-10-20T04:00:00.000Z"))).toBe("2026-10-20T04:00:00Z");
    expect(() => toRedditReportHour(new Date("2026-10-20T04:30:00Z"))).toThrow();
  });
});
