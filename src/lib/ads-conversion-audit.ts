// Conversion-action audit rules for the Ads Dashboard. Pure — no API or DB
// access — so the judgement calls below are unit-tested.
//
// What the audit is for: metrics.conversions is whatever the ACCOUNT is
// configured to count. If a tap on a phone number or a page view is set up
// as a counted action, Google reports it as a conversion exactly like a
// real lead. Live example that motivated this: one account's 189
// "conversions" in a month were 179 website click-to-call taps.
//
// Two facts about Google's own flags, both confirmed against live accounts,
// that this code must not assume away:
//   - include_in_conversions_metric does NOT predict whether an action
//     counts: actions with it false contributed to metrics.conversions.
//   - primary_for_goal false does not guarantee zero either: one account
//     had a non-primary action contribute a conversion.
// So "does it count" is decided only by what it actually contributed in
// the window, never by a flag.

export type AuditActionInput = {
  id: string;
  name: string;
  // False when metrics reported the action but conversion_action didn't
  // list it (seen live — e.g. an action owned outside the account).
  listed: boolean;
  status: string; // ENABLED | REMOVED | HIDDEN | ""
  type: string; // ConversionActionType name
  category: string; // ConversionActionCategory name
  origin: string;
  primaryForGoal: boolean | null;
  includeInConversionsMetric: boolean | null;
  conversions: number; // metrics.conversions in the window
  allConversions: number;
  priorConversions: number;
  byChannel: Record<string, number>; // metrics.conversions by campaign channel type
};

export type AuditVerdict =
  // Counted in the window and looks like a non-lead action.
  | "junk_counted"
  // Set as primary and looks like a non-lead action, but counted nothing
  // in this window — would inflate conversions the moment it fires.
  | "junk_primary_idle"
  // Counted in the window and needs a human look (reason says why).
  | "review"
  | "ok"
  | "not_counting";

export type AuditedAction = AuditActionInput & {
  verdict: AuditVerdict;
  reasons: string[];
};

// Categories that describe something other than a lead for a lead-gen
// account. Wording is shown to the user as-is.
const JUNK_CATEGORY_REASONS: Record<string, string> = {
  CONTACT:
    "Counts a tap on a phone number or contact link, not a completed call — the call itself may never connect",
  PAGE_VIEW: "Counts a page view, not a lead",
  ENGAGEMENT: "Counts an engagement (e.g. a local action), not a lead",
  GET_DIRECTIONS: "Counts a directions request, not a lead",
  OUTBOUND_CLICK: "Counts a click out to another site, not a lead",
  STORE_VISIT: "Counts an estimated store visit, not a lead",
  DOWNLOAD: "Counts a download or app install, not a lead",
  YOUTUBE_FOLLOW_ON_VIEWS: "Counts a YouTube view, not a lead",
  ADD_TO_CART: "E-commerce action on a lead-gen account",
  BEGIN_CHECKOUT: "E-commerce action on a lead-gen account",
};

const JUNK_NAME_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /click[s]?[\s-]*to[\s-]*call|tap[\s-]*to[\s-]*call|\btel[\s:_-]*click|phone[\s-]*click/i,
    reason: "Named as a click-to-call — counts the tap, not a completed call",
  },
  { pattern: /page[\s_-]*view|\bvisit|scroll|time[\s_-]*on[\s_-]*(site|page)|session/i, reason: "Named as a visit/page-view style action, not a lead" },
  { pattern: /engag|direction/i, reason: "Named as an engagement/directions action, not a lead" },
];

function junkReasons(a: AuditActionInput): string[] {
  const reasons: string[] = [];
  const byCategory = JUNK_CATEGORY_REASONS[a.category];
  if (byCategory) reasons.push(byCategory);
  for (const { pattern, reason } of JUNK_NAME_PATTERNS) {
    if (pattern.test(a.name) && !reasons.some((r) => r.slice(0, 20) === reason.slice(0, 20))) {
      // A click-to-call filed under a lead category is the worst case:
      // it reads as a web/phone lead in every report.
      reasons.push(
        byCategory ? reason : `${reason} (filed under ${a.category || "no category"}, so it reads as a lead)`,
      );
    }
  }
  return reasons;
}

export function auditAction(a: AuditActionInput): AuditedAction {
  const counted = a.conversions > 0;
  const junk = junkReasons(a);

  if (junk.length > 0 && counted) return { ...a, verdict: "junk_counted", reasons: junk };
  if (junk.length > 0 && a.primaryForGoal === true && a.status === "ENABLED") {
    return {
      ...a,
      verdict: "junk_primary_idle",
      reasons: [...junk, "Set as primary but counted nothing in this window"],
    };
  }
  if (!counted) return { ...a, verdict: "not_counting", reasons: [] };

  const review: string[] = [];
  if (!a.listed) {
    review.push("Counted, but not in this account's conversion-action list — its settings can't be read here");
  } else if (a.primaryForGoal === false) {
    review.push("Counted even though it is not set as primary");
  }
  if (a.category === "DEFAULT") {
    review.push('Uncategorised ("Other") — confirm what it measures');
  }
  return review.length > 0
    ? { ...a, verdict: "review", reasons: review }
    : { ...a, verdict: "ok", reasons: [] };
}

export type AuditSummary = {
  totalConversions: number;
  junkConversions: number;
  reviewConversions: number;
  cleanConversions: number;
  // junkConversions / totalConversions, null when nothing converted.
  junkShare: number | null;
  junkCountedActions: number;
  junkPrimaryIdleActions: number;
};

const VERDICT_ORDER: Record<AuditVerdict, number> = {
  junk_counted: 0,
  review: 1,
  junk_primary_idle: 2,
  ok: 3,
  not_counting: 4,
};

export function auditConversionActions(inputs: AuditActionInput[]): {
  actions: AuditedAction[];
  summary: AuditSummary;
} {
  const actions = inputs
    .map(auditAction)
    .sort(
      (a, b) =>
        VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
        b.conversions - a.conversions ||
        b.allConversions - a.allConversions ||
        a.name.localeCompare(b.name),
    );
  const sum = (v: AuditVerdict) =>
    actions.filter((a) => a.verdict === v).reduce((n, a) => n + a.conversions, 0);
  const totalConversions = actions.reduce((n, a) => n + a.conversions, 0);
  const junkConversions = sum("junk_counted");
  const reviewConversions = sum("review");
  return {
    actions,
    summary: {
      totalConversions,
      junkConversions,
      reviewConversions,
      cleanConversions: sum("ok"),
      junkShare: totalConversions > 0 ? junkConversions / totalConversions : null,
      junkCountedActions: actions.filter((a) => a.verdict === "junk_counted").length,
      junkPrimaryIdleActions: actions.filter((a) => a.verdict === "junk_primary_idle").length,
    },
  };
}
