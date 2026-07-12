import type { ColumnInfo } from "./database";

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

/** Extract PK columns from a row + column metadata. Returns null if no PKs. */
export function buildRowIdentity(
  row: Record<string, unknown>,
  columns: ColumnInfo[],
): RowIdentity | null {
  const pkCols = columns.filter((c) => c.isPrimary);
  if (pkCols.length === 0) return null;
  return {
    pkColumns: pkCols.map((c) => c.name),
    pkValues: pkCols.map((c) => row[c.name] ?? null),
  };
}

/** Stable string key for a RowIdentity (used as Map key). */
export function identityKey(identity: RowIdentity): string {
  return identity.pkValues.map((v) => JSON.stringify(v)).join("::");
}
