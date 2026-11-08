import { useMutation } from "@tanstack/react-query";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { ExportSummary, ImportError, ImportProgress, ImportSummary } from "../types/dump";
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
// `progress` fills in live while the import runs, errors included.
export function useImportDump() {
  const [progress, setProgress] = useState<{ done: number; total: number; errors: ImportError[] }>({
    done: 0,
    total: 0,
    errors: [],
  });

  const mutation = useMutation<ImportSummary, string, { connectionId: string; filePath: string }>({
    mutationFn: async (input) => {
      setProgress({ done: 0, total: 0, errors: [] });
      const onProgress = new Channel<ImportProgress>(({ done, total, error }) =>
        setProgress((prev) => ({ done, total, errors: error ? [...prev.errors, error] : prev.errors })),
      );
      try {
        return await invoke<ImportSummary>("import_sql_dump", { ...input, onProgress });
      } catch (error) {
        throw getErrorMessage(error, "Import failed");
      }
    },
  });

  return { ...mutation, progress };
}
