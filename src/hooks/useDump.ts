import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { ExportSummary, ImportError, ImportSummary } from "../types/dump";
import { getErrorMessage } from "../lib/error";

// Write the whole database to a .sql file
export function useExportDump() {
  return useMutation({
    mutationFn: (input: { connectionId: string; database: string | null; filePath: string }) =>
      invoke<ExportSummary>("export_database_dump", input),
  });
}

// Run a .sql file against the connection's current database
export function useImportDump() {
  return useMutation<ImportSummary, ImportError, { connectionId: string; filePath: string }>({
    mutationFn: async (input) => {
      try {
        return await invoke<ImportSummary>("import_sql_dump", input);
      } catch (error) {
        throw toImportError(error);
      }
    },
  });
}

// import_sql_dump rejects with an ImportError object; anything else (e.g. an IPC failure) is a string or Error
export function toImportError(error: unknown): ImportError {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    const { line, snippet, hint } = error as Partial<ImportError>;
    return { message: error.message, line: line ?? null, snippet: snippet ?? null, hint: hint ?? null };
  }
  return { message: getErrorMessage(error, "Import failed"), line: null, snippet: null, hint: null };
}
