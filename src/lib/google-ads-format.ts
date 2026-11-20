// Shared number/label formatters for the Google Ads workspace, so the
// server page and the client-side expandable table render identically.

export const money0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const int = (n: number) => Math.round(n).toLocaleString("en-US");

export const conv1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");

export const pct2 = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(2)}%`);

const TYPE_LABELS: Record<string, string> = {
  SEARCH: "Search",
  PERFORMANCE_MAX: "PMax",
  DISPLAY: "Display",
  VIDEO: "Video",
  SHOPPING: "Shopping",
  LOCAL_SERVICES: "LSA",
  DEMAND_GEN: "Demand Gen",
  MULTI_CHANNEL: "Multi-channel",
};

// Humanises a Google enum name (channel type, ad group type, ad type, …):
// known channel types get a short label, anything else becomes Title Case.
export function enumLabel(t: string | null): string {
  if (!t) return "—";
  return (
    TYPE_LABELS[t] ??
    t.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
