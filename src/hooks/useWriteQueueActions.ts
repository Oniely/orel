import type { QueryResult } from "../types/database";
import type { PendingChange } from "../types/write-queue";
import { buildRowIdentity } from "../types/write-queue";
import { useWriteQueueStore } from "../stores/write-queue.store";
import { useApplyWriteQueue, useApplyRowChanges, useCopySql } from "./useWriteQueue";

const EMPTY_INSERTS: PendingChange[] = [];

export function useWriteQueueActions(
  scopeKey: string | null,
  connectionId: string | null,
  activeTableName: string | null,
  queryResult: QueryResult | null,
) {
  const applyMutation = useApplyWriteQueue();
  const applyRowMutation = useApplyRowChanges();
  const copySqlMutation = useCopySql();

  // Derived state
  const columns = queryResult?.columns ?? [];
  const rows = queryResult?.rows ?? [];
  const hasPrimaryKey = columns.some((c) => c.isPrimary);

  // Single reactive subscription — provides changeCount, insertedRows, and dirty state for DataGrid
  const tableChanges = useWriteQueueStore((s) => (scopeKey ? s.tables[scopeKey] : undefined));
  const changeCount = tableChanges ? tableChanges.changes.size + tableChanges.inserts.length : 0;
  const insertedRows = tableChanges?.inserts ?? EMPTY_INSERTS;

  // Helper: get identity for a row index (deduplicates the repeated pattern)
  const getIdentity = (rowIndex: number) => {
    const row = rows[rowIndex];
    return row ? buildRowIdentity(row, columns) : null;
  };

  const handleCellEdit = (rowIndex: number, column: string, oldValue: unknown, newValue: unknown) => {
    if (!scopeKey) return;
    const identity = getIdentity(rowIndex);
    if (!identity) return;
    useWriteQueueStore.getState().stageUpdate(scopeKey, identity, [{ column, oldValue, newValue }]);
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (!scopeKey) return;
    const identity = getIdentity(rowIndex);
    if (!identity) return;
    useWriteQueueStore.getState().stageDelete(scopeKey, identity);
  };

  const handleUndoDeleteRow = (rowIndex: number) => {
    if (!scopeKey) return;
    const identity = getIdentity(rowIndex);
    if (!identity) return;
    useWriteQueueStore.getState().unstageRow(scopeKey, identity);
  };

  const handleInsertCellEdit = (insertIndex: number, column: string, value: unknown) => {
    if (!scopeKey) return;
    useWriteQueueStore.getState().updateInsert(scopeKey, insertIndex, column, value);
  };

  const handleRemoveInsert = (insertIndex: number) => {
    if (!scopeKey) return;
    useWriteQueueStore.getState().removeInsert(scopeKey, insertIndex);
  };

  const handleAddRow = () => {
    if (!scopeKey) return;
    useWriteQueueStore.getState().stageInsert(scopeKey, {});
  };

  const handleApplyRow = async (rowIndex: number): Promise<boolean> => {
    if (!scopeKey || !connectionId || !activeTableName) return false;
    const identity = getIdentity(rowIndex);
    if (!identity) return false;
    const rowChanges = useWriteQueueStore.getState().getRowChanges(scopeKey, identity);
    if (rowChanges.length === 0) return false;
    await applyRowMutation.mutateAsync({
      connectionId,
      table: activeTableName,
      changes: rowChanges,
    });
    useWriteQueueStore.getState().unstageRow(scopeKey, identity);
    return true;
  };

  const handleReset = () => {
    if (!scopeKey) return;
    useWriteQueueStore.getState().clearTable(scopeKey);
  };

  const handleApply = () => {
    if (!scopeKey || !connectionId || !activeTableName) return;
    const changes = useWriteQueueStore.getState().getChanges(scopeKey);
    if (changes.length === 0) return;
    applyMutation.mutate({ connectionId, table: activeTableName, changes, scopeKey });
  };

  const handleCopySql = () => {
    if (!scopeKey || !connectionId || !activeTableName) return;
    const changes = useWriteQueueStore.getState().getChanges(scopeKey);
    if (changes.length === 0) return;
    copySqlMutation.mutate({ connectionId, table: activeTableName, changes });
  };

  const isRowDeleted = (rowIndex: number): boolean => {
    if (!scopeKey || !hasPrimaryKey) return false;
    const identity = getIdentity(rowIndex);
    if (!identity) return false;
    return useWriteQueueStore.getState().getRowChangeKind(scopeKey, identity) === "Delete";
  };

  return {
    hasPrimaryKey,
    scopeKey,
    changeCount,
    insertedRows,
    tableChanges,
    isApplying: applyMutation.isPending,
    isApplyingRow: applyRowMutation.isPending,
    handleCellEdit,
    handleDeleteRow,
    handleUndoDeleteRow,
    handleInsertCellEdit,
    handleRemoveInsert,
    handleAddRow,
    handleApplyRow,
    handleReset,
    handleApply,
    handleCopySql,
    isRowDeleted,
  };
}

export type WriteQueueActions = ReturnType<typeof useWriteQueueActions>;
