import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ExportSummary, ImportSummary } from "../types/dump";
import { getErrorMessage } from "../lib/error";

// Write the whole database to a .sql file
export function useExportDump() {
  return useMutation({
    mutationFn: (input: { connectionId: string; database: string | null; filePath: string }) =>
      invoke<ExportSummary>("export_database_dump", input),
  });
}

// Run a .sql file against the connection's current database. Statements that
// fail don't stop the ones after them — failures land in summary.errors
// instead of rejecting the mutation. Rejecting still happens for problems
// before any statement runs (file not found, no statements in the file).
export function useImportDump() {
  return useMutation<ImportSummary, string, { connectionId: string; filePath: string }>({
    mutationFn: async (input) => {
      try {
        return await invoke<ImportSummary>("import_sql_dump", input);
      } catch (error) {
        throw getErrorMessage(error, "Import failed");
      }
    },
  });
}
