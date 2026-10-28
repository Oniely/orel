import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@heroui/react";
import { useWriteQueueStore } from "../stores/write-queue.store";
import type { PendingChange, ApplyResult } from "../types/write-queue";
import { databaseQueryKeys } from "./useTables";

interface ApplyInput {
  connectionId: string;
  database: string;
  table: string;
  changes: PendingChange[];
  scopeKey: string;
}

interface DatabaseTarget {
  connectionId: string;
  database: string;
}

/** Resolves once the visible rows have been refetched */
function invalidateRows(queryClient: QueryClient, target: DatabaseTarget) {
  return queryClient.invalidateQueries({
    queryKey: databaseQueryKeys.rowsForDatabase(target.connectionId, target.database),
  });
}

function invalidateDatabaseData(queryClient: QueryClient, target: DatabaseTarget) {
  queryClient.invalidateQueries({
    queryKey: databaseQueryKeys.tables(target.connectionId, target.database),
  });
  return invalidateRows(queryClient, target);
}

export function useApplyWriteQueue(scopeKey: string | null) {
  const queryClient = useQueryClient();
  const clearTable = useWriteQueueStore((s) => s.clearTable);

  return useMutation({
    mutationKey: ["write-queue", "apply", scopeKey],
    mutationFn: (input: ApplyInput) =>
      invoke<ApplyResult>("apply_write_queue", {
        connectionId: input.connectionId,
        table: input.table,
        changes: input.changes,
      }),
    // Same ordering issue as useApplyRowChanges below: clearTable() wipes the
    // pending-edit overlay immediately, so it must not run until the fresh
    // rows are already in the cache, or the grid flashes the stale value.
    onSuccess: async (result, input) => {
      const total = result.applied.length + (result.failed ? 1 : 0) + result.notAttempted.length;
      if (!result.failed) {
        await invalidateDatabaseData(queryClient, input);
        clearTable(input.scopeKey);
        toast.success(`Applied ${result.applied.length} change(s)`);
      } else {
        const [failIdx, error] = result.failed;
        if (result.applied.length === 0) {
          // Full rollback (transactional)
          toast.danger(`Failed: ${error}. All changes rolled back.`);
        } else {
          // Partial failure (non-transactional)
          toast.danger(
            `${result.applied.length} of ${total} applied. Change #${failIdx + 1} failed: ${error}. ${result.notAttempted.length} not attempted.`,
          );
          // Refresh to show the applied changes
          invalidateRows(queryClient, input);
        }
      }
    },
    onError: (error) => {
      toast.danger(error instanceof Error ? error.message : "Failed to apply changes");
    },
  });
}

export function useApplyRowChanges(scopeKey: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["write-queue", "apply-row", scopeKey],
    mutationFn: (input: { connectionId: string; database: string; table: string; changes: PendingChange[] }) =>
      invoke<ApplyResult>("apply_write_queue", {
        connectionId: input.connectionId,
        table: input.table,
        changes: input.changes,
      }),
    // Returning the refetch makes mutateAsync wait for fresh rows, so the caller
    // doesn't unstage the edit while the stale value is still on screen
    onSuccess: (_result, input) => invalidateDatabaseData(queryClient, input),
    onError: (error) => {
      toast.danger(error instanceof Error ? error.message : "Failed to apply row changes");
    },
  });
}

interface CopySqlInput {
  connectionId: string;
  table: string;
  changes: PendingChange[];
}

export function useCopySql() {
  return useMutation({
    mutationFn: (input: CopySqlInput) =>
      invoke<string[]>("generate_sql", {
        connectionId: input.connectionId,
        table: input.table,
        changes: input.changes,
      }),
    onSuccess: (sqls) => {
      navigator.clipboard.writeText(sqls.join(";\n") + ";");
      toast.success("SQL copied to clipboard");
    },
    onError: (error) => {
      toast.danger(error instanceof Error ? error.message : "Failed to generate SQL");
    },
  });
}
