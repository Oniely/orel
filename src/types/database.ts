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
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  totalEstimate: number | null;
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
