import { useFetchRows } from "../useTables";
import { useWriteQueueActions } from "../useWriteQueueActions";
import { getErrorMessage } from "../../lib/error";
import { useDashboardContext } from "./useDashboardContext";

export function useActiveTable() {
  const { connectionId, activeDatabase, activeTableName, scopeKey } = useDashboardContext();
  const rowsQuery = useFetchRows(connectionId, activeDatabase, activeTableName);
  const queryResult = rowsQuery.error ? null : (rowsQuery.data ?? null);
  const writeQueue = useWriteQueueActions(scopeKey, connectionId, activeDatabase, activeTableName, queryResult);

  return {
    queryResult,
    rows: queryResult?.rows ?? [],
    columns: queryResult?.columns ?? [],
    totalEstimate: queryResult?.totalEstimate ?? null,
    isLoading: rowsQuery.isLoading || rowsQuery.isFetching,
    error: rowsQuery.error ? getErrorMessage(rowsQuery.error, "Failed to load rows") : null,
    writeQueue,
  };
}
