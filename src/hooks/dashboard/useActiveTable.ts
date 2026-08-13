import { useShallow } from "zustand/react/shallow";
import { useFetchRows } from "../useTables";
import { useWriteQueueActions } from "../useWriteQueueActions";
import { getErrorMessage } from "../../lib/error";
import { useDashboardContext } from "./useDashboardContext";
import { useDashboardStore, EMPTY_FILTER_STATE, DEFAULT_PAGINATION } from "../../stores/dashboard.store";

export function useActiveTable() {
  const { connectionId, activeDatabase, activeTableName, scopeKey } = useDashboardContext();

  const { filterState, pagination, setPage } = useDashboardStore(
    useShallow((s) => ({
      filterState: s.tableFilters[scopeKey ?? ""] ?? EMPTY_FILTER_STATE,
      pagination: s.tablePagination[scopeKey ?? ""] ?? DEFAULT_PAGINATION,
      setPage: s.setPage,
    })),
  );

  const rowsQuery = useFetchRows(
    connectionId,
    activeDatabase,
    activeTableName,
    pagination.limit,
    pagination.page,
    filterState.applied,
  );
  const queryResult = rowsQuery.error ? null : (rowsQuery.data ?? null);
  const writeQueue = useWriteQueueActions(scopeKey, connectionId, activeDatabase, activeTableName, queryResult);

  return {
    queryResult,
    rows: queryResult?.rows ?? [],
    columns: queryResult?.columns ?? [],
    totalResults: queryResult?.totalResults ?? 0,
    totalPages: queryResult?.totalPages ?? 1,
    page: pagination.page,
    limit: pagination.limit,
    setPage: (p: number) => setPage(scopeKey, p),
    isLoading: rowsQuery.isLoading || rowsQuery.isFetching,
    error: rowsQuery.error ? getErrorMessage(rowsQuery.error, "Failed to load rows") : null,
    writeQueue,
  };
}
