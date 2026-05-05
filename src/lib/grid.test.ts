import { describe, expect, it } from "vitest";
import { generateGrid, haversineMiles } from "./grid";

describe("generateGrid", () => {
  it("produces size*size points", () => {
    const points = generateGrid({
      centerLat: 33.7589,
      centerLng: -84.388,
      size: 7,
      radiusMiles: 5,
    });
    expect(points).toHaveLength(49);
  });

  it("rejects invalid sizes", () => {
    expect(() =>
      generateGrid({ centerLat: 0, centerLng: 0, size: 4, radiusMiles: 1 }),
    ).toThrow();
    expect(() =>
      generateGrid({ centerLat: 0, centerLng: 0, size: 15, radiusMiles: 1 }),
    ).toThrow();
  });

  it("rejects non-positive radius", () => {
    expect(() =>
      generateGrid({ centerLat: 0, centerLng: 0, size: 5, radiusMiles: 0 }),
    ).toThrow();
  });

  it("center cell sits on the input center for odd grids", () => {
    const points = generateGrid({
      centerLat: 44.9778,
      centerLng: -93.265,
      size: 5,
      radiusMiles: 3,
    });
    const center = points.find((p) => p.gridX === 2 && p.gridY === 2);
    expect(center).toBeDefined();
    expect(center!.lat).toBeCloseTo(44.9778, 6);
    expect(center!.lng).toBeCloseTo(-93.265, 6);
  });

  it("northern (Minneapolis) corner-to-corner spans approximately 2*radius*sqrt(2)", () => {
    const radiusMiles = 5;
    const points = generateGrid({
      centerLat: 44.9778,
      centerLng: -93.265,
      size: 7,
      radiusMiles,
    });
    const tl = points.find((p) => p.gridX === 0 && p.gridY === 0)!;
    const br = points.find((p) => p.gridX === 6 && p.gridY === 6)!;
    const diagonal = haversineMiles(tl.lat, tl.lng, br.lat, br.lng);
    const expected = 2 * radiusMiles * Math.sqrt(2);
    expect(diagonal).toBeCloseTo(expected, 0);
  });

  it("southern (Miami) corner-to-corner spans approximately 2*radius*sqrt(2)", () => {
    const radiusMiles = 5;
    const points = generateGrid({
      centerLat: 25.7617,
      centerLng: -80.1918,
      size: 7,
      radiusMiles,
    });
    const tl = points.find((p) => p.gridX === 0 && p.gridY === 0)!;
    const br = points.find((p) => p.gridX === 6 && p.gridY === 6)!;
    const diagonal = haversineMiles(tl.lat, tl.lng, br.lat, br.lng);
    const expected = 2 * radiusMiles * Math.sqrt(2);
    expect(diagonal).toBeCloseTo(expected, 0);
  });

  it("equator center-to-edge equals radiusMiles", () => {
    const radiusMiles = 4;
    const points = generateGrid({
      centerLat: 0,
      centerLng: 0,
      size: 5,
      radiusMiles,
    });
    const center = points.find((p) => p.gridX === 2 && p.gridY === 2)!;
    const right = points.find((p) => p.gridX === 4 && p.gridY === 2)!;
    const top = points.find((p) => p.gridX === 2 && p.gridY === 0)!;
    expect(haversineMiles(center.lat, center.lng, right.lat, right.lng)).toBeCloseTo(
      radiusMiles,
      1,
    );
    expect(haversineMiles(center.lat, center.lng, top.lat, top.lng)).toBeCloseTo(
      radiusMiles,
      1,
    );
  });

  it("ordering is row-major, top-to-bottom, left-to-right", () => {
    const points = generateGrid({
      centerLat: 0,
      centerLng: 0,
      size: 3,
      radiusMiles: 1,
    });
    const first = points[0];
    const last = points[points.length - 1];
    expect(first.gridX).toBe(0);
    expect(first.gridY).toBe(0);
    expect(last.gridX).toBe(2);
    expect(last.gridY).toBe(2);
    expect(first.lat).toBeGreaterThan(last.lat);
    expect(first.lng).toBeLessThan(last.lng);
  });
});
