import type { QueryResult } from "../types/database";
import type { PendingChange } from "../types/write-queue";
import { buildRowIdentity, identityKey } from "../types/write-queue";
import { useWriteQueueStore } from "../stores/write-queue.store";
import { useApplyWriteQueue, useApplyRowChanges, useCopySql } from "./useWriteQueue";
import { useIsMutating } from "@tanstack/react-query";

const EMPTY_INSERTS: PendingChange[] = [];
const SAVED_HIGHLIGHT_MS = 3000;
const savedHighlightTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function useWriteQueueActions(
  scopeKey: string | null,
  connectionId: string | null,
  activeDatabase: string | null,
  activeTableName: string | null,
  queryResult: QueryResult | null,
) {
  const applyMutation = useApplyWriteQueue(scopeKey);
  const applyRowMutation = useApplyRowChanges(scopeKey);
  const copySqlMutation = useCopySql();
  const isApplying = useIsMutating({ mutationKey: ["write-queue", "apply", scopeKey] }) > 0;
  const isApplyingRow =
    useIsMutating({ mutationKey: ["write-queue", "apply-row", scopeKey] }) > 0;

  const columns = queryResult?.columns ?? [];
  const rows = queryResult?.rows ?? [];
  const hasPrimaryKey = columns.some((c) => c.isPrimary);

  const tableChanges = useWriteQueueStore((s) => (scopeKey ? s.tables[scopeKey] : undefined));

  const recentlySaved = useWriteQueueStore((state) =>
    scopeKey ? state.recentlySaved[scopeKey] : undefined,
  );
  const changeCount = tableChanges ? tableChanges.changes.size + tableChanges.inserts.length : 0;
  const insertedRows = tableChanges?.inserts ?? EMPTY_INSERTS;

  const markCellsSaved = (entries: Array<[string, string[]]>) => {
    if (!scopeKey || entries.length === 0) return;
    useWriteQueueStore.getState().markRecentlySaved(scopeKey, entries);
    for (const [key] of entries) {
      const timerKey = `${scopeKey}::${key}`;
      const old = savedHighlightTimers.get(timerKey);
      if (old) clearTimeout(old);
      savedHighlightTimers.set(
        timerKey,
        setTimeout(() => {
          savedHighlightTimers.delete(timerKey);
          useWriteQueueStore.getState().clearRecentlySavedRow(scopeKey, key);
        }, SAVED_HIGHLIGHT_MS),
      );
    }
  };

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
    if (!scopeKey || !connectionId || !activeDatabase || !activeTableName) return false;
    const identity = getIdentity(rowIndex);
    if (!identity) return false;
    const rowChanges = useWriteQueueStore.getState().getRowChanges(scopeKey, identity);
    if (rowChanges.length === 0) return false;

    const changedColumns = rowChanges[0]?.kind === "Update" ? rowChanges[0].changes.map((c) => c.column) : [];

    await applyRowMutation.mutateAsync({
      connectionId,
      database: activeDatabase,
      table: activeTableName,
      changes: rowChanges,
    });

    const iKey = identityKey(identity);
    useWriteQueueStore.getState().unstageRow(scopeKey, identity);
    markCellsSaved([[iKey, changedColumns]]);

    return true;
  };

  const handleReset = () => {
    if (!scopeKey) return;
    useWriteQueueStore.getState().clearTable(scopeKey);
  };

  const handleApply = async () => {
    if (!scopeKey || !connectionId || !activeDatabase || !activeTableName) return;
    const changes = useWriteQueueStore.getState().getChanges(scopeKey);
    if (changes.length === 0) return;

    const savedEntries: Array<[string, string[]]> = [];
    for (const change of changes) {
      if (change.kind === "Update") {
        savedEntries.push([identityKey(change.identity), change.changes.map((c) => c.column)]);
      }
    }

    await applyMutation.mutateAsync({
      connectionId,
      database: activeDatabase,
      table: activeTableName,
      changes,
      scopeKey,
    });
    markCellsSaved(savedEntries);
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
    isApplying,
    isApplyingRow,
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
    recentlySaved,
  };
}

export type WriteQueueActions = ReturnType<typeof useWriteQueueActions>;
