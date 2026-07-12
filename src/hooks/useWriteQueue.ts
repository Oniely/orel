import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@heroui/react";
import { useWriteQueueStore } from "../stores/write-queue.store";
import type { PendingChange, ApplyResult } from "../types/write-queue";

interface ApplyInput {
  connectionId: string;
  table: string;
  changes: PendingChange[];
  scopeKey: string;
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
        queryClient.invalidateQueries({ queryKey: ["rows", input.connectionId, input.table] });
        queryClient.invalidateQueries({ queryKey: ["tables", input.connectionId] });
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
          queryClient.invalidateQueries({ queryKey: ["rows", input.connectionId, input.table] });
        }
      }
    },
    onError: (error) => {
      toast.danger(error instanceof Error ? error.message : "Failed to apply changes");
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
