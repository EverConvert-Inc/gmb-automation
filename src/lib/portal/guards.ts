// Row checks for every portal query. Unlike the admin-side row guard, which
// inspects only the first row (cheap crosstalk detection), these check EVERY
// row: the question here is tenancy, not just shape, and a portal result is
// small enough that walking it costs nothing.
//
// Two failures, both of which THROW instead of rendering:
//  - shape: a missing key or a wrong type. With rows keyed by column name, a
//    result that reached the wrong query arrives with the wrong keys.
//  - tenancy: a row whose firm_id is not the session's firm.

export type FieldKind =
  | "string"
  | "string?"
  | "number"
  | "boolean"
  | "boolean?"
  | "date"
  | "date?";

export class PortalRowError extends Error {
  constructor(
    readonly label: string,
    readonly rowIndex: number,
    readonly field: string,
    readonly detail: string,
  ) {
    super(`Portal query "${label}", row ${rowIndex}, field "${field}": ${detail}`);
    this.name = "PortalRowError";
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (value instanceof Date) return "Date";
  return typeof value;
}

function matches(value: unknown, kind: FieldKind): boolean {
  const optional = kind.endsWith("?");
  if (optional && (value === null || value === undefined)) return true;
  switch (optional ? kind.slice(0, -1) : kind) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return value instanceof Date && !Number.isNaN(value.getTime());
    default:
      return false;
  }
}

/**
 * Checks every row against `spec`, and that every key in `equals` holds
 * exactly that value. Throws on the first violation.
 */
export function assertRows(
  label: string,
  rows: readonly unknown[],
  spec: Record<string, FieldKind>,
  equals: Record<string, unknown> = {},
): asserts rows is Record<string, unknown>[] {
  rows.forEach((row, i) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new PortalRowError(label, i, "(row)", `not an object (${describe(row)})`);
    }
    const r = row as Record<string, unknown>;
    for (const [field, kind] of Object.entries(spec)) {
      if (!matches(r[field], kind)) {
        throw new PortalRowError(label, i, field, `expected ${kind}, got ${describe(r[field])}`);
      }
    }
    for (const [field, expected] of Object.entries(equals)) {
      if (r[field] !== expected) {
        throw new PortalRowError(label, i, field, "does not match the session");
      }
    }
  });
}

/**
 * assertRows plus the tenancy rule: every row carries firm_id, and it is the
 * session's firm. firm_id is required even if the caller forgot to list it.
 */
export function assertFirmRows(
  label: string,
  rows: readonly unknown[],
  sessionFirmId: string,
  spec: Record<string, FieldKind>,
): asserts rows is Record<string, unknown>[] {
  assertRows(label, rows, { ...spec, firm_id: "string" }, { firm_id: sessionFirmId });
}
