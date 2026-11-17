import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGbpPlaceIndex, GbpHttpError } from "./gbp";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildGbpPlaceIndex", () => {
  it("finds a listing under whichever account or location group holds it now", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")) {
          return jsonResponse({ accounts: [{ name: "accounts/111" }, { name: "accounts/222" }] });
        }
        if (url.includes("/v1/accounts/111/locations")) {
          return jsonResponse({ locations: [{ name: "locations/A", metadata: { placeId: "pA" } }] });
        }
        if (url.includes("/v1/accounts/222/locations")) {
          return jsonResponse({
            locations: [
              { name: "locations/B", metadata: { placeId: "pB" } },
              { name: "locations/NOPLACE", metadata: {} },
            ],
          });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const index = await buildGbpPlaceIndex("t");
    expect(Object.fromEntries(index.byPlaceId)).toEqual({
      pA: { accountId: "111", locationId: "A" },
      pB: { accountId: "222", locationId: "B" },
    });
    expect(index.failedAccounts).toEqual([]);
  });

  it("records an account it couldn't list instead of failing the whole scan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")) {
          return jsonResponse({ accounts: [{ name: "accounts/111" }, { name: "accounts/222" }] });
        }
        if (url.includes("/v1/accounts/111/locations")) return jsonResponse({ error: { code: 403 } }, 403);
        return jsonResponse({ locations: [{ name: "locations/B", metadata: { placeId: "pB" } }] });
      }),
    );
    const index = await buildGbpPlaceIndex("t");
    expect([...index.byPlaceId.keys()]).toEqual(["pB"]);
    expect(index.failedAccounts).toEqual(["accounts/111"]);
  });
});

describe("GbpHttpError", () => {
  it("keeps the HTTP status so a 404 can be told apart", () => {
    const err = new GbpHttpError("GBP reviews fetch failed: 404 {}", 404);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
    expect(err.message).toBe("GBP reviews fetch failed: 404 {}");
  });
});
