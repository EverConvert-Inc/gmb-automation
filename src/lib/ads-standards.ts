// Pure logic for Audit standards (/ads/standards, /ads/audit): the enforceable
// fields, how a campaign is matched to a standard, and how its live settings
// are scored against the enforced ones. No I/O.

import type { CampaignSettings } from "./queries-ads-dashboard";

export type MatchRule = {
  channelType?: string; // e.g. "SEARCH", "PERFORMANCE_MAX" — empty = any
  nameContains?: string; // case-insensitive substring — empty = any
};

// Only the keys present are enforced; value is the required value.
export type Expected = Record<string, string | boolean>;

export type Standard = {
  id: string;
  name: string;
  enabled: boolean;
  match: MatchRule;
  campaignExpected: Expected;
  adGroupExpected: Expected;
};

export type EnforceableField = {
  key: string;
  label: string;
  type: "enum" | "bool";
  options?: { value: string; label: string }[];
  actual: (c: CampaignSettings) => string | boolean;
  // Campaign types the setting means nothing for. Scoring it there would
  // report a false error, so the campaign goes to "needs review" instead.
  notApplicableTo?: string[];
};

// Performance Max picks its own inventory: it has no network toggles, so
// whatever the API echoes back for them isn't a setting anyone chose.
const NETWORK_NA = ["PERFORMANCE_MAX"];

// Campaign-level enforceable settings, read straight off the live settings.
export const CAMPAIGN_FIELDS: EnforceableField[] = [
  {
    key: "biddingStrategy",
    label: "Bidding strategy",
    type: "enum",
    options: [
      { value: "MANUAL_CPC", label: "Manual CPC" },
      { value: "ENHANCED_CPC", label: "Enhanced CPC" },
      { value: "MAXIMIZE_CONVERSIONS", label: "Maximize conversions" },
      { value: "MAXIMIZE_CONVERSION_VALUE", label: "Maximize conversion value" },
      { value: "TARGET_CPA", label: "Target CPA" },
      { value: "TARGET_ROAS", label: "Target ROAS" },
      { value: "TARGET_SPEND", label: "Target spend" },
    ],
    actual: (c) => c.biddingStrategy,
  },
  {
    key: "budgetDelivery",
    label: "Budget delivery",
    type: "enum",
    options: [
      { value: "STANDARD", label: "Standard" },
      { value: "ACCELERATED", label: "Accelerated" },
    ],
    actual: (c) => c.budgetDelivery,
  },
  {
    key: "adServing",
    label: "Ad serving",
    type: "enum",
    options: [
      { value: "OPTIMIZE", label: "Optimize" },
      { value: "ROTATE_INDEFINITELY", label: "Rotate indefinitely" },
      { value: "ROTATE", label: "Rotate" },
      { value: "CONVERSION_OPTIMIZE", label: "Conversion optimize" },
    ],
    actual: (c) => c.adServing,
  },
  { key: "budgetShared", label: "Shared budget", type: "bool", actual: (c) => c.budgetShared },
  { key: "trackingTemplateSet", label: "Tracking template set", type: "bool", actual: (c) => c.trackingTemplate !== "" },
  { key: "networkGoogleSearch", label: "Google Search network", type: "bool", actual: (c) => c.networks.googleSearch, notApplicableTo: NETWORK_NA },
  { key: "networkSearchPartners", label: "Search partners network", type: "bool", actual: (c) => c.networks.searchPartners, notApplicableTo: NETWORK_NA },
  { key: "networkDisplay", label: "Display network", type: "bool", actual: (c) => c.networks.display, notApplicableTo: NETWORK_NA },
  { key: "networkYouTube", label: "YouTube network", type: "bool", actual: (c) => c.networks.youtube, notApplicableTo: NETWORK_NA },
];

const FIELD_BY_KEY = new Map(CAMPAIGN_FIELDS.map((f) => [f.key, f]));

export function matchesStandard(c: CampaignSettings, m: MatchRule): boolean {
  if (m.channelType && m.channelType !== c.type) return false;
  if (m.nameContains && !c.name.toLowerCase().includes(m.nameContains.toLowerCase())) return false;
  return true;
}

export type FieldFailure = { key: string; label: string; expected: string | boolean; actual: string | boolean };

// An enforced setting that couldn't be judged, and why.
export type FieldUnverified = {
  key: string;
  label: string;
  expected: string | boolean;
  reason: "not_applicable" | "unknown";
};

export type Verdict = "passed" | "error" | "review" | "unmatched";

export type CampaignVerdict = {
  campaignId: string;
  verdict: Verdict;
  standardId: string | null;
  standardName: string | null;
  failures: FieldFailure[];
  unverified: FieldUnverified[];
};

// Enum values that say "Google didn't tell us", not a real setting.
const UNKNOWN_ENUM = new Set(["", "UNKNOWN", "UNSPECIFIED", "UNAVAILABLE"]);

// First enabled standard whose match holds governs the campaign. A definite
// mismatch is an error. Otherwise, if any enforced setting couldn't be judged
// (not applicable to this campaign type, or Google returned no real value),
// the campaign needs review rather than passing on settings nobody checked.
export function evaluateCampaign(c: CampaignSettings, standards: Standard[]): CampaignVerdict {
  const std = standards.find((s) => s.enabled && matchesStandard(c, s.match));
  if (!std) {
    return {
      campaignId: c.campaignId,
      verdict: "unmatched",
      standardId: null,
      standardName: null,
      failures: [],
      unverified: [],
    };
  }
  const failures: FieldFailure[] = [];
  const unverified: FieldUnverified[] = [];
  for (const [key, expected] of Object.entries(std.campaignExpected)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) continue;
    if (field.notApplicableTo?.includes(c.type)) {
      unverified.push({ key, label: field.label, expected, reason: "not_applicable" });
      continue;
    }
    const actual = field.actual(c);
    if (field.type === "enum" && typeof actual === "string" && UNKNOWN_ENUM.has(actual)) {
      unverified.push({ key, label: field.label, expected, reason: "unknown" });
      continue;
    }
    if (actual !== expected) failures.push({ key, label: field.label, expected, actual });
  }
  return {
    campaignId: c.campaignId,
    verdict: failures.length > 0 ? "error" : unverified.length > 0 ? "review" : "passed",
    standardId: std.id,
    standardName: std.name,
    failures,
    unverified,
  };
}

export type ComplianceSummary = {
  evaluated: number; // matched to a standard and judged: passed + errors
  passed: number;
  errors: number;
  review: number; // matched, but an enforced setting couldn't be judged
  unmatched: number;
  compliancePct: number | null; // passed / evaluated (review is left out)
};

export function evaluateCompliance(
  campaigns: CampaignSettings[],
  standards: Standard[],
): { verdicts: CampaignVerdict[]; summary: ComplianceSummary } {
  const verdicts = campaigns.map((c) => evaluateCampaign(c, standards));
  const passed = verdicts.filter((v) => v.verdict === "passed").length;
  const errors = verdicts.filter((v) => v.verdict === "error").length;
  const review = verdicts.filter((v) => v.verdict === "review").length;
  const unmatched = verdicts.filter((v) => v.verdict === "unmatched").length;
  const evaluated = passed + errors;
  return {
    verdicts,
    summary: {
      evaluated,
      passed,
      errors,
      review,
      unmatched,
      compliancePct: evaluated > 0 ? passed / evaluated : null,
    },
  };
}
