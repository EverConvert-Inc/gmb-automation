import { describe, expect, it } from "vitest";
import {
  decodeTag,
  dispatchWithConcurrency,
  encodeTag,
  estimateScanCost,
  findRankForPlaceId,
} from "./dataforseo";

describe("encode/decodeTag", () => {
  it("round trips", () => {
    const tag = {
      scanId: "abc",
      scanPointId: "def",
      keywordId: "ghi",
      gridX: 3,
      gridY: 5,
    };
    const decoded = decodeTag(encodeTag(tag));
    expect(decoded).toEqual(tag);
  });

  it("rejects malformed tags", () => {
    expect(decodeTag("a|b|c")).toBeNull();
    expect(decodeTag("a|b|c|x|2")).toBeNull();
  });
});

describe("findRankForPlaceId", () => {
  it("finds the place and returns top 5 competitors", () => {
    const { rank, competitors } = findRankForPlaceId(
      {
        items: [
          { type: "maps_search", rank_absolute: 1, place_id: "p1", title: "First" },
          { type: "maps_search", rank_absolute: 2, place_id: "p2", title: "Second" },
          { type: "maps_search", rank_absolute: 3, place_id: "target", title: "Target" },
          { type: "maps_search", rank_absolute: 4, place_id: "p4", title: "Fourth" },
          { type: "maps_search", rank_absolute: 5, place_id: "p5", title: "Fifth" },
          { type: "maps_search", rank_absolute: 6, place_id: "p6", title: "Sixth" },
          { type: "maps_search", rank_absolute: 7, place_id: "p7", title: "Seventh" },
        ],
      },
      "target",
    );
    expect(rank).toBe(3);
    expect(competitors).toHaveLength(5);
    expect(competitors[0].placeId).toBe("p1");
  });

  it("returns null rank if place is missing", () => {
    const { rank, competitors } = findRankForPlaceId(
      {
        items: [
          { type: "maps_search", rank_absolute: 1, place_id: "p1", title: "First" },
        ],
      },
      "missing",
    );
    expect(rank).toBeNull();
    expect(competitors).toHaveLength(1);
  });

  it("ignores non-maps_search items", () => {
    const { rank } = findRankForPlaceId(
      {
        items: [
          { type: "ad", rank_absolute: 1, place_id: "target" },
          { type: "maps_search", rank_absolute: 1, place_id: "target" },
        ],
      },
      "target",
    );
    expect(rank).toBe(1);
  });
});

describe("dispatchWithConcurrency", () => {
  it("processes all items even when some reject", async () => {
    const results = await dispatchWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      if (n === 3) throw new Error("boom");
      return n * 2;
    });
    expect(results).toHaveLength(5);
    expect(results[2].status).toBe("rejected");
    expect(results[0]).toEqual({ status: "fulfilled", value: 2 });
    expect(results[4]).toEqual({ status: "fulfilled", value: 10 });
  });

  it("respects concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    await dispatchWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("estimateScanCost", () => {
  it("matches the RFD's 7x7 x 5kw ~ $0.147 estimate", () => {
    const cost = estimateScanCost(7, 5);
    expect(cost).toBeCloseTo(0.147, 3);
  });
});
