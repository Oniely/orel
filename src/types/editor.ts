export type EditorMode = "autoCommit" | "manual";
export type TransactionState = "inactive" | "active" | "failed";

export interface SqlCell {
  kind: "null" | "boolean" | "number" | "text" | "json" | "binary";
  display: string | null;
}

export interface SqlResultColumn {
  name: string;
  dataType: string;
  isPrimary: boolean;
}

export interface SqlErrorInfo {
  message: string;
  code: string | null;
}

export interface StatementResult {
  index: number;
  kind: "rows" | "affected" | "message" | "error";
  columns: SqlResultColumn[];
  rows: SqlCell[][];
  rowCount: number;
  rowsAffected: number;
  truncated: boolean;
  rowLimit: number;
  elapsedMs: number;
  message: string | null;
  error: SqlErrorInfo | null;
}

export interface EditorExecutionResponse {
  results: StatementResult[];
  transactionState: TransactionState;
  forceManual: boolean;
  elapsedMs: number;
}

export interface SqlEditorViewState {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
  scrollTop: number;
  scrollLeft: number;
}

export interface SqlEditorState {
  mode: EditorMode;
  transactionState: TransactionState;
  operationPending: boolean;
  results: StatementResult[];
  activeResultIndex: number;
  viewState?: SqlEditorViewState;
}

export const createSqlEditorState = (): SqlEditorState => ({
  mode: "autoCommit",
  transactionState: "inactive",
  operationPending: false,
  results: [],
  activeResultIndex: 0,
});
