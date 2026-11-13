// Google never reports an impression share below 10%: anything under it
// comes back as the sentinel 0.0999 (confirmed live on keyword_view,
// campaign and ad_group). It is a floor, not a measurement, so it must
// render as "<10%" and never as 9.99% or 10%.
export const IMPRESSION_SHARE_FLOOR = 0.1;

export function formatImpressionShare(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v < IMPRESSION_SHARE_FLOOR) return "<10%";
  return `${(v * 100).toFixed(0)}%`;
}
