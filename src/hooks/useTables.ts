import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type {
  FilterRow,
  TableInfo,
  QueryResult,
  TableDdl,
  TableStructure,
  StructureChanges,
  TableIndex,
  IndexChanges,
} from "../types/database";

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
  rowsForTable: (connectionId: string, database: string | null, table: string) =>
    ["rows", connectionId, database, table] as const,
  tableStructureForConnection: (connectionId: string) => ["table-structure", connectionId] as const,
  tableStructureForDatabase: (connectionId: string, database: string) =>
    ["table-structure", connectionId, database] as const,
  tableStructure: (connectionId: string | null, database: string | null, table: string | null) =>
    ["table-structure", connectionId, database, table] as const,
  tableIndexesForConnection: (connectionId: string) => ["table-indexes", connectionId] as const,
  tableIndexesForDatabase: (connectionId: string, database: string) =>
    ["table-indexes", connectionId, database] as const,
  tableIndexes: (connectionId: string | null, database: string | null, table: string | null) =>
    ["table-indexes", connectionId, database, table] as const,
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

export function useFetchTableStructure(
  connectionId: string | null,
  database: string | null,
  table: string | null,
) {
  return useQuery({
    queryKey: databaseQueryKeys.tableStructure(connectionId, database, table),
    queryFn: () =>
      invoke<TableStructure>("fetch_table_structure", {
        connectionId: connectionId!,
        table: table!,
      }),
    enabled: !!connectionId && !!database && !!table,
    staleTime: 30_000,
  });
}

interface ApplyStructureInput {
  connectionId: string;
  database: string | null;
  table: string;
  changes: StructureChanges;
}

export function useApplyStructureChanges() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, table, changes }: ApplyStructureInput) =>
      invoke<string[]>("apply_structure_changes", { connectionId, table, changes }),
    onSuccess: (_stmts, { connectionId, database, table }) => {
      void queryClient.invalidateQueries({
        queryKey: databaseQueryKeys.tableStructure(connectionId, database, table),
      });
      void queryClient.invalidateQueries({
        queryKey: databaseQueryKeys.tableDdl(connectionId, database, table),
      });
      // Dropping or renaming a column changes the indexes on it
      void queryClient.invalidateQueries({
        queryKey: databaseQueryKeys.tableIndexes(connectionId, database, table),
      });
      // Cached rows carry the old column list
      void queryClient.invalidateQueries({
        queryKey: databaseQueryKeys.rowsForTable(connectionId, database, table),
      });
    },
  });
}

export function useFetchTableIndexes(
  connectionId: string | null,
  database: string | null,
  table: string | null,
) {
  return useQuery({
    queryKey: databaseQueryKeys.tableIndexes(connectionId, database, table),
    queryFn: () =>
      invoke<TableIndex[]>("fetch_table_indexes", {
        connectionId: connectionId!,
        table: table!,
      }),
    enabled: !!connectionId && !!database && !!table,
    staleTime: 30_000,
  });
}

interface ApplyIndexInput {
  connectionId: string;
  database: string | null;
  table: string;
  changes: IndexChanges;
}

export function useApplyIndexChanges() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, table, changes }: ApplyIndexInput) =>
      invoke<string[]>("apply_index_changes", { connectionId, table, changes }),
    onSuccess: (_stmts, { connectionId, database, table }) => {
      void queryClient.invalidateQueries({
        queryKey: databaseQueryKeys.tableIndexes(connectionId, database, table),
      });
      // Key glyphs on the Columns tab come from the structure query. Mark it stale
      // without refetching: the Indexes tab only reads column names/types from it,
      // which an index change doesn't touch, and the Columns tab refetches on mount.
      void queryClient.invalidateQueries({
        queryKey: databaseQueryKeys.tableStructure(connectionId, database, table),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: databaseQueryKeys.tableDdl(connectionId, database, table),
      });
    },
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
