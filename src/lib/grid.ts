export type GridPoint = {
  gridX: number;
  gridY: number;
  lat: number;
  lng: number;
};

export type GridGenerationInput = {
  centerLat: number;
  centerLng: number;
  size: number;
  radiusMiles: number;
};

const MILES_PER_DEGREE_LAT = 69;
const VALID_SIZES = [3, 5, 7, 9, 11, 13];

export function generateGrid({
  centerLat,
  centerLng,
  size,
  radiusMiles,
}: GridGenerationInput): GridPoint[] {
  if (!VALID_SIZES.includes(size)) {
    throw new Error(`Grid size must be one of ${VALID_SIZES.join(", ")}; got ${size}`);
  }
  if (radiusMiles <= 0) {
    throw new Error(`radiusMiles must be positive; got ${radiusMiles}`);
  }
  if (centerLat < -90 || centerLat > 90) {
    throw new Error(`centerLat out of range: ${centerLat}`);
  }
  if (centerLng < -180 || centerLng > 180) {
    throw new Error(`centerLng out of range: ${centerLng}`);
  }

  const half = (size - 1) / 2;
  const stepMiles = radiusMiles / half;
  const stepLatDeg = stepMiles / MILES_PER_DEGREE_LAT;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  // Near the poles, longitude convergence makes this division explode; cap so a
  // pathological lat doesn't produce nonsense steps.
  const safeCos = Math.max(Math.abs(cosLat), 1e-6);
  const stepLngDeg = stepMiles / (MILES_PER_DEGREE_LAT * safeCos);

  const points: GridPoint[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - half;
      const dy = half - y;
      points.push({
        gridX: x,
        gridY: y,
        lat: centerLat + dy * stepLatDeg,
        lng: centerLng + dx * stepLngDeg,
      });
    }
  }
  return points;
}

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
