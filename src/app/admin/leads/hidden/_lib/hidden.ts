// "Hidden from clients: no usable name" — leads the portal would show right
// now but for their name. Staff-only (callers check first); read-only.

import { listHiddenByNameCandidates, type AdminLeadRow } from "@/lib/leads/queries-admin";
import { isHiddenByNameNow, portalWindowNow } from "@/app/admin/firms/[id]/_lib/firm-status";

/**
 * The SQL narrows to candidates with the portal's own name SQL; the final
 * decision is isHiddenByNameNow — the portal's isClientVisible, monthAnchor
 * and hasUsableName — so this list cannot drift from what the client sees.
 */
export async function listHiddenByName(): Promise<AdminLeadRow[]> {
  const window = portalWindowNow();
  const rows = await listHiddenByNameCandidates(window);
  return rows
    .filter((r) =>
      isHiddenByNameNow(
        {
          effectiveStatus: r.status,
          effectiveOpportunity: r.isOpportunity,
          needsReview: r.needsReview,
          hasStatusOverride: r.statusOverride !== null,
          statusTagMatched: r.statusTagMatched,
          occurredAt: r.occurredAt,
          signedAt: r.signedAt,
          name: r.name,
          hasNameOverride: r.nameOverride !== null && r.nameOverride.trim() !== "",
        },
        window,
      ),
    )
    .map((r) => {
      const row: AdminLeadRow & { nameOverride?: string | null } = { ...r };
      delete row.nameOverride;
      return row;
    });
}

/** Rows grouped by firm, in the order given (firm name, newest first). */
export function groupByFirm(rows: readonly AdminLeadRow[]): { firmId: string; firmName: string; rows: AdminLeadRow[] }[] {
  const groups = new Map<string, { firmId: string; firmName: string; rows: AdminLeadRow[] }>();
  for (const r of rows) {
    const id = r.firmId ?? "";
    const g = groups.get(id) ?? { firmId: id, firmName: r.firmName ?? "—", rows: [] };
    g.rows.push(r);
    groups.set(id, g);
  }
  return [...groups.values()];
}
