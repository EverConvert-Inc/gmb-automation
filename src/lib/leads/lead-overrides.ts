// Admin edits to a lead, and the rule that decides when the "Apply?" prompt
// appears. Pure except for the zod import — no DB, no network.

import { z } from "zod";

export const LEAD_STATUSES = ["pending", "signed"] as const;

/**
 * Every writable field is an *_override column. The *_parsed columns are not
 * nameable here, which is the mechanism behind "an admin edit never touches
 * what CallRail said" — .strict() means a request naming one is rejected
 * rather than ignored.
 *
 * null is meaningful and distinct from absent: null CLEARS an override, so
 * the effective value falls back to the parsed one.
 */
export const LeadOverridePatch = z
  .object({
    statusOverride: z.enum(LEAD_STATUSES).nullable().optional(),
    isOpportunityOverride: z.boolean().nullable().optional(),
    nameOverride: z.string().nullable().optional(),
    phoneOverride: z.string().nullable().optional(),
    /** Writes suggestedStatus into statusOverride. */
    applySuggestedStatus: z.literal(true).optional(),
  })
  .strict();

export type LeadOverridePatchInput = z.infer<typeof LeadOverridePatch>;

/**
 * Option B: the tags drive status automatically and an admin override always
 * wins. suggested_status exists only to power the prompt, so the prompt is
 * shown ONLY when an override exists AND the tag-derived status disagrees
 * with it. Without an override there is nothing to disagree with — the
 * tag-derived status is already the effective one.
 */
export function shouldPromptApply(lead: {
  statusOverride: string | null;
  suggestedStatus: string | null;
}): boolean {
  return (
    lead.statusOverride !== null &&
    lead.suggestedStatus !== null &&
    lead.suggestedStatus !== lead.statusOverride
  );
}

export type OverrideUpdateResult =
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; error: string };

function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Turns a validated patch into the exact column set to write. Returns only
 * *_override columns plus updated_at — nothing else can be reached from
 * here, by construction rather than by remembering.
 */
export function buildOverrideUpdate(
  patch: LeadOverridePatchInput,
  lead: { suggestedStatus: string | null; statusOverride: string | null },
  now: Date,
): OverrideUpdateResult {
  const update: Record<string, unknown> = {};

  if (patch.applySuggestedStatus) {
    if (!lead.suggestedStatus) {
      return { ok: false, error: "There is no suggested status to apply." };
    }
    if (patch.statusOverride !== undefined) {
      return {
        ok: false,
        error: "Send either applySuggestedStatus or statusOverride, not both.",
      };
    }
    // "Clearing the suggestion" is agreement, not deletion. Nulling
    // suggested_status would be undone by the next sync, which recomputes it
    // from the tags; once the override equals it, the prompt is gone.
    update.statusOverride = lead.suggestedStatus;
  } else if (patch.statusOverride !== undefined) {
    update.statusOverride = patch.statusOverride;
  }

  if (patch.isOpportunityOverride !== undefined) {
    update.isOpportunityOverride = patch.isOpportunityOverride;
  }
  if (patch.nameOverride !== undefined) {
    update.nameOverride = emptyToNull(patch.nameOverride);
  }
  if (patch.phoneOverride !== undefined) {
    update.phoneOverride = emptyToNull(patch.phoneOverride);
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "Nothing to change." };
  }

  update.updatedAt = now;
  return { ok: true, update };
}

/** The only writable columns, pinned so a test can assert the boundary. */
export const WRITABLE_OVERRIDE_COLUMNS = [
  "statusOverride",
  "isOpportunityOverride",
  "nameOverride",
  "phoneOverride",
  "updatedAt",
] as const;
