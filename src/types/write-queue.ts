import type { ColumnInfo } from "./database";
import type { SqlCell } from "./editor";

export interface RowIdentity {
  pkColumns: string[];
  pkValues: unknown[];
}

export interface ColumnChange {
  column: string;
  oldValue: unknown;
  newValue: unknown;
}

export type PendingChange =
  | { kind: "Update"; identity: RowIdentity; changes: ColumnChange[] }
  | { kind: "Delete"; identity: RowIdentity }
  | { kind: "Insert"; values: Record<string, unknown> };

export interface ApplyResult {
  applied: number[];
  failed: [number, string] | null;
  notAttempted: number[];
}

/**
 * Convert a SqlCell back to a typed JSON-serializable value for use in the write queue.
 * Preserves proper types (number, boolean, null) so format_sql_value in Rust emits
 * unquoted literals (42 not '42', TRUE not 'TRUE').
 */
export function sqlCellToValue(cell: SqlCell | undefined): unknown {
  if (!cell || cell.kind === "null" || cell.display === null) return null;
  if (cell.kind === "boolean") return cell.display === "true";
  if (cell.kind === "number") {
    const n = Number(cell.display);
    return Number.isFinite(n) ? n : cell.display;
  }
  return cell.display;
}

/** Extract PK columns from a row + column metadata. Returns null if no PKs. */
export function buildRowIdentity(
  row: Record<string, SqlCell>,
  columns: ColumnInfo[],
): RowIdentity | null {
  const pkCols = columns.filter((c) => c.isPrimary);
  if (pkCols.length === 0) return null;
  return {
    pkColumns: pkCols.map((c) => c.name),
    pkValues: pkCols.map((c) => sqlCellToValue(row[c.name])),
  };
}

/** Stable string key for a RowIdentity (used as Map key). */
export function identityKey(identity: RowIdentity): string {
  return identity.pkValues.map((v) => JSON.stringify(v)).join("::");
}
