import type { IndexAddPayload, ReferentialAction, StructureColumn } from "./database";

// Staged, unsaved changes for the Structure view's tabs. Each tab has its own
// draft and its own Save; drafts are kept per table (see structure-drafts.store).

export type ColumnEdit = Pick<StructureColumn, "name" | "dataType" | "typeParams" | "isNullable" | "defaultValue">;

export interface PendingColumn extends ColumnEdit {
  tempId: string;
}

export interface ColumnsDraft {
  /** Changed fields only, keyed by the column's saved name */
  edits: Record<string, Partial<ColumnEdit>>;
  deletes: string[];
  adds: PendingColumn[];
  /** Full column order when it was changed, otherwise null */
  reorder: string[] | null;
}

export interface PendingIndex extends IndexAddPayload {
  tempId: string;
  /** Once the user edits the name it stops following the columns */
  nameTouched: boolean;
}

export interface IndexesDraft {
  drops: string[];
  adds: PendingIndex[];
}

export interface PendingForeignKey {
  tempId: string;
  name: string;
  /** Once the user edits the name it stops following the column */
  nameTouched: boolean;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onUpdate: ReferentialAction;
  onDelete: ReferentialAction;
}

export interface ForeignKeysDraft {
  drops: string[];
  adds: PendingForeignKey[];
}

export interface StructureDrafts {
  columns: ColumnsDraft;
  indexes: IndexesDraft;
  foreignKeys: ForeignKeysDraft;
}

export type StructureDraftTab = keyof StructureDrafts;
