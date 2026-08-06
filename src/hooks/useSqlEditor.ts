import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { EditorExecutionResponse, EditorMode, TransactionState } from "../types/editor";

export function useExecuteEditorSql() {
  return useMutation({
    mutationFn: (input: { connectionId: string; editorId: string; sql: string; mode: EditorMode }) =>
      invoke<EditorExecutionResponse>("execute_editor_sql", input),
  });
}

export function useBeginEditorTransaction() {
  return useMutation({
    mutationFn: (input: { connectionId: string; editorId: string }) =>
      invoke<TransactionState>("begin_editor_transaction", input),
  });
}

export function useCommitEditorTransaction() {
  return useMutation({
    mutationFn: (editorId: string) =>
      invoke<TransactionState>("commit_editor_transaction", { editorId }),
  });
}

export function useRollbackEditorTransaction() {
  return useMutation({
    mutationFn: (editorId: string) =>
      invoke<TransactionState>("rollback_editor_transaction", { editorId }),
  });
}

export function useDiscardEditorSession() {
  return useMutation({
    mutationFn: (editorId: string) => invoke<void>("discard_editor_session", { editorId }),
  });
}
