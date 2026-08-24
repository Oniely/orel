import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { FilterRow, TableInfo, QueryResult, TableDdl } from "../types/database";

export const databaseQueryKeys = {
  databases: (connectionId: string | null) => ["databases", connectionId] as const,
  tablesForConnection: (connectionId: string) => ["tables", connectionId] as const,
  tables: (connectionId: string | null, database: string | null) => ["tables", connectionId, database] as const,
  tableDdlForConnection: (connectionId: string) => ["table-ddl", connectionId] as const,
  tableDdlForDatabase: (connectionId: string, database: string) => ["table-ddl", connectionId, database] as const,
  tableDdl: (connectionId: string | null, database: string | null, table: string | null) =>
    ["table-ddl", connectionId, database, table] as const,
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

export function useFetchTableDdl(connectionId: string | null, database: string | null, table: string | null) {
  return useQuery({
    queryKey: databaseQueryKeys.tableDdl(connectionId, database, table),
    queryFn: () =>
      invoke<TableDdl>("fetch_table_ddl", {
        connectionId: connectionId!,
        table: table!,
      }),
    enabled: !!connectionId && !!database && !!table,
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
      invoke<QueryResult>("fetch_rows", {
        connectionId: connectionId!,
        table: table!,
        limit,
        offset,
        filters,
      }),
    enabled: !!connectionId && !!database && !!table,
    staleTime: 30_000,
  });
}
