import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { TableInfo, QueryResult } from "../types/database";

export function useListTables(connectionId: string | null) {
  return useQuery({
    queryKey: ["tables", connectionId],
    queryFn: () => invoke<TableInfo[]>("list_tables", { connectionId: connectionId! }),
    enabled: !!connectionId,
    staleTime: 30_000,
  });
}

export function useFetchRows(
  connectionId: string | null,
  table: string | null,
  limit = 100,
  offset = 0
) {
  return useQuery({
    queryKey: ["rows", connectionId, table, limit, offset],
    queryFn: () =>
      invoke<QueryResult>("fetch_rows", {
        connectionId: connectionId!,
        table: table!,
        limit,
        offset,
      }),
    enabled: !!connectionId && !!table,
  });
}
