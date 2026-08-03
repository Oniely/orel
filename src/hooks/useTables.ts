import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { TableInfo, QueryResult } from "../types/database";

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
    offset: number,
  ) => ["rows", connectionId, database, table, limit, offset] as const,
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
  offset = 0
) {
  return useQuery({
    queryKey: databaseQueryKeys.rows(connectionId, database, table, limit, offset),
    queryFn: () =>
      invoke<QueryResult>("fetch_rows", {
        connectionId: connectionId!,
        table: table!,
        limit,
        offset,
      }),
    enabled: !!connectionId && !!database && !!table,
  });
}
