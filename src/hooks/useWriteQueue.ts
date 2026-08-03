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

function invalidateRows(queryClient: QueryClient, target: DatabaseTarget) {
  queryClient.invalidateQueries({
    queryKey: databaseQueryKeys.rowsForDatabase(target.connectionId, target.database),
  });
}

function invalidateDatabaseData(queryClient: QueryClient, target: DatabaseTarget) {
  invalidateRows(queryClient, target);
  queryClient.invalidateQueries({
    queryKey: databaseQueryKeys.tables(target.connectionId, target.database),
  });
}

export function useApplyWriteQueue() {
  const queryClient = useQueryClient();
  const clearTable = useWriteQueueStore((s) => s.clearTable);

  return useMutation({
    mutationFn: (input: ApplyInput) =>
      invoke<ApplyResult>("apply_write_queue", {
        connectionId: input.connectionId,
        table: input.table,
        changes: input.changes,
      }),
    onSuccess: (result, input) => {
      const total = result.applied.length + (result.failed ? 1 : 0) + result.notAttempted.length;
      if (!result.failed) {
        clearTable(input.scopeKey);
        invalidateDatabaseData(queryClient, input);
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

export function useApplyRowChanges() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { connectionId: string; database: string; table: string; changes: PendingChange[] }) =>
      invoke<ApplyResult>("apply_write_queue", {
        connectionId: input.connectionId,
        table: input.table,
        changes: input.changes,
      }),
    onSuccess: (_result, input) => {
      invalidateDatabaseData(queryClient, input);
    },
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
