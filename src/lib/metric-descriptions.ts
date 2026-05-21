// Short hover-tooltip strings for KPI labels across the app. Keep these
// terse — they appear inside a small tooltip bubble.

export const METRIC_DESCRIPTIONS = {
  arp: "Average Rank Position. Mean rank across grid points where your business appeared in the top 100. Lower is better.",
  solv: "Share of Local Voice. Percentage of grid points where you ranked in the top 3 — i.e., visible above the fold.",
  coverage: "Percentage of grid points where you ranked anywhere in the top 100 (vs. being absent).",
  lastScan: "When the most recent grid scan completed for this location.",
  rating: "Average star rating across all Google reviews synced for this location.",
  daysSinceLastReview:
    "Days since the most recent Google review was posted. Green ≤ 14d, amber ≤ 45d, red beyond.",
  reviewsLast7:
    "Reviews received in the last 7 days. The pill compares against the prior 7-day window.",
  reviewsLast30:
    "Reviews received in the last 30 days. The pill compares against the prior 30-day window.",
} as const;

export type MetricKey = keyof typeof METRIC_DESCRIPTIONS;
