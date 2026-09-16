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
