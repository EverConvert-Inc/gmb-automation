export type ScanPointMetricInput = {
  rank: number | null;
};

export type ScanMetrics = {
  arp: number | null;
  solv: number;
  coverage: number;
  totalPoints: number;
  rankedPoints: number;
};

export type ArpStrategy = "ignore_null" | "treat_null_as_21" | "treat_null_as_100";

export function computeScanMetrics(
  points: ScanPointMetricInput[],
  strategy: ArpStrategy = "ignore_null",
): ScanMetrics {
  const total = points.length;
  if (total === 0) {
    return { arp: null, solv: 0, coverage: 0, totalPoints: 0, rankedPoints: 0 };
  }

  const ranked = points.filter((p) => p.rank !== null && p.rank > 0);
  const top3 = ranked.filter((p) => (p.rank as number) <= 3).length;

  let arp: number | null;
  if (strategy === "ignore_null") {
    arp =
      ranked.length === 0
        ? null
        : ranked.reduce((acc, p) => acc + (p.rank as number), 0) / ranked.length;
  } else {
    const fill = strategy === "treat_null_as_21" ? 21 : 100;
    const sum = points.reduce((acc, p) => acc + (p.rank ?? fill), 0);
    arp = sum / total;
  }

  return {
    arp,
    solv: (top3 / total) * 100,
    coverage: (ranked.length / total) * 100,
    totalPoints: total,
    rankedPoints: ranked.length,
  };
}

export function rankColor(rank: number | null): string {
  if (rank === null) return "#9ca3af";
  if (rank <= 3) return "#22c55e";
  if (rank <= 10) return "#facc15";
  if (rank <= 20) return "#fb923c";
  return "#ef4444";
}

export function rankBucket(rank: number | null): "1-3" | "4-10" | "11-20" | "21+" | "none" {
  if (rank === null) return "none";
  if (rank <= 3) return "1-3";
  if (rank <= 10) return "4-10";
  if (rank <= 20) return "11-20";
  return "21+";
}
