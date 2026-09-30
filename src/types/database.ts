export interface TableInfo {
  name: string;
  tableType: "table" | "view";
  rowEstimate: number | null;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimary: boolean;
  hasDefault: boolean;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  totalResults: number;
  totalPages: number;
}

export interface TableDdl {
  ddl: string;
  dialect: "postgres" | "mysql" | "sqlite";
  source: "native" | "generated";
}

export interface StructureColumn {
  name: string;
  dataType: string;
  typeParams: string | null;
  isNullable: boolean;
  isPrimary: boolean;
  isForeignKey: boolean;
  isIndexed: boolean;
  defaultValue: string | null;
}

export interface TableStructure {
  columns: StructureColumn[];
  dialect: "postgres" | "mysql" | "sqlite";
}

export interface ColumnEditPayload {
  originalName: string;
  name: string;
  dataType: string;
  typeParams: string | null;
  nullable: boolean;
  defaultValue: string | null;
}

export interface ColumnAddPayload {
  name: string;
  dataType: string;
  typeParams: string | null;
  nullable: boolean;
  defaultValue: string | null;
}

export interface StructureChanges {
  edits: ColumnEditPayload[];
  drops: string[];
  adds: ColumnAddPayload[];
  reorder: string[] | null;
}

export interface IndexColumn {
  /** Column name, or the expression text when isExpression is true */
  name: string;
  descending: boolean;
  isExpression: boolean;
  prefixLength: number | null;
}

export interface TableIndex {
  name: string;
  columns: IndexColumn[];
  isUnique: boolean;
  isPrimary: boolean;
  method: string | null;
  droppable: boolean;
}

export interface IndexColumnPayload {
  name: string;
  descending: boolean;
  prefixLength: number | null;
}

export interface IndexAddPayload {
  name: string;
  unique: boolean;
  columns: IndexColumnPayload[];
}

export interface IndexChanges {
  drops: string[];
  adds: IndexAddPayload[];
}

export type ReferentialAction = "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";

export interface ForeignKey {
  /** Null on SQLite, which doesn't expose constraint names */
  name: string | null;
  columns: string[];
  /** Set only when the referenced table is outside `public` / the current database */
  referencedSchema: string | null;
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: ReferentialAction;
  onDelete: ReferentialAction;
}

export interface ForeignKeyAddPayload {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: ReferentialAction;
  onDelete: ReferentialAction;
}

export interface ForeignKeyChanges {
  drops: string[];
  adds: ForeignKeyAddPayload[];
}

export type FilterOperator =
  | "equals"
  | "not equals"
  | "contains"
  | "starts with"
  | "in"
  | "not in"
  | ">"
  | "<"
  | ">="
  | "<="
  | "is null"
  | "is not null";

export interface FilterRow {
  col: string;
  op: FilterOperator;
  val: string;
  conjunction: "AND" | "OR";
}
