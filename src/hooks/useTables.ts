import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { FilterRow, TableInfo, QueryResult, ColumnInfo } from "../types/database";
import type { SqlCell } from "../types/editor";

// Raw shape returned by the Rust `fetch_rows` command — rows are index-ordered arrays
interface RawQueryResult {
  columns: ColumnInfo[];
  rows: SqlCell[][];
  totalResults: number;
  totalPages: number;
}

export const databaseQueryKeys = {
  databases: (connectionId: string | null) => ["databases", connectionId] as const,
  tablesForConnection: (connectionId: string) => ["tables", connectionId] as const,
  tables: (connectionId: string | null, database: string | null) => ["tables", connectionId, database] as const,
  rowsForConnection: (connectionId: string) => ["rows", connectionId] as const,
  rows: (
    connectionId: string | null,
    database: string | null,
    table: string | null,
    limit: number,
    page: number,
    filters: FilterRow[],
  ) => ["rows", connectionId, database, table, limit, page, filters] as const,
  rowsForDatabase: (connectionId: string, database: string) => ["rows", connectionId, database] as const,
};

export function useListTables(connectionId: string | null, database: string | null) {
  return useQuery({
    queryKey: databaseQueryKeys.tables(connectionId, database),
    queryFn: () => invoke<TableInfo[]>("list_tables", { connectionId: connectionId! }),
    enabled: !!connectionId && !!database,
    staleTime: 30_000,
  });
}

export function useFetchRows(
  connectionId: string | null,
  database: string | null,
  table: string | null,
  limit = 100,
  page = 1,
  filters: FilterRow[] = [],
) {
  const offset = (page - 1) * limit;
  return useQuery({
    queryKey: databaseQueryKeys.rows(connectionId, database, table, limit, page, filters),
    queryFn: () =>
      invoke<RawQueryResult>("fetch_rows", {
        connectionId: connectionId!,
        table: table!,
        limit,
        offset,
        filters,
      }),
    select: (raw): QueryResult => ({
      columns: raw.columns,
      rows: raw.rows.map((row) =>
        raw.columns.reduce<Record<string, SqlCell>>((acc, col, i) => {
          acc[col.name] = row[i];
          return acc;
        }, {}),
      ),
      totalResults: raw.totalResults,
      totalPages: raw.totalPages,
    }),
    enabled: !!connectionId && !!database && !!table,
    staleTime: 30_000,
  });
}
