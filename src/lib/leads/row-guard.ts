// A shape assertion for query results, to make response crosstalk LOUD.
//
// Drizzle asks postgres-js for rows in positional array mode and maps them by
// position, not by name (drizzle-orm/postgres-js/session.js: it calls
// client.unsafe(...).values() and then mapResultRow). There is no column-name
// check anywhere in that path. So if a response is ever delivered to the
// wrong query's promise, the result is not an error — it is a row of the
// right shape filled with another query's values. A count of 1 landing in a
// `name` slot renders a firm called "1".
//
// The cost of checking is O(1), not O(rows): crosstalk happens per RESPONSE,
// so every row in a crossed result is wrong in the same way. Inspecting the
// first row is enough to catch it, and nothing is gained by walking 500.
//
// What this CANNOT catch: two queries whose result shapes are identical —
// two different selects over `leads`, say. A guard distinguishes shapes, not
// contents, so it narrows the blast radius rather than closing it.

export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "string?"
  | "number?"
  | "boolean?"
  | "date?";

export class RowShapeError extends Error {
  constructor(
    readonly label: string,
    readonly field: string,
    readonly expected: FieldKind,
    readonly received: string,
  ) {
    super(
      `Query result shape mismatch in ${label}: expected "${field}" to be ${expected}, got ${received}. ` +
        `This usually means a response reached the wrong query — see row-guard.ts.`,
    );
    this.name = "RowShapeError";
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Date) return "Date";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matches(value: unknown, kind: FieldKind): boolean {
  const optional = kind.endsWith("?");
  if (optional && (value === null || value === undefined)) return true;
  const base = optional ? kind.slice(0, -1) : kind;
  switch (base) {
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
 * Throws if the first row does not match `spec`. An empty result passes —
 * there is nothing to inspect, and a crossed empty response is
 * indistinguishable from a genuine one either way.
 */
export function assertRowShape<T>(
  label: string,
  rows: readonly T[],
  spec: Record<string, FieldKind>,
): void {
  if (rows.length === 0) return;
  const row = rows[0] as Record<string, unknown>;
  if (row === null || typeof row !== "object") {
    throw new RowShapeError(label, "(row)", "string", describe(row));
  }
  for (const [field, kind] of Object.entries(spec)) {
    if (!matches(row[field], kind)) {
      throw new RowShapeError(label, field, kind, describe(row[field]));
    }
  }
}

/** The single-row form, for findFirst-style lookups. */
export function assertRow<T>(
  label: string,
  row: T | null | undefined,
  spec: Record<string, FieldKind>,
): void {
  if (row === null || row === undefined) return;
  assertRowShape(label, [row], spec);
}
