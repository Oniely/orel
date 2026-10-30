export interface ExportSummary {
  tablesExported: number;
  viewsExported: number;
  rowsExported: number;
  filePath: string;
}

/** One failed statement from an import; collected in ImportSummary.errors. */
export interface ImportError {
  message: string;
  /** 1-indexed line of the failing statement */
  line: number | null;
  /** Up to ~200 chars of the failing statement */
  snippet: string | null;
  /** Plain-language hint when the dump looks like it's for another database */
  hint: string | null;
}

export interface ImportSummary {
  statementsExecuted: number;
  statementsFailed: number;
  tablesAffected: number;
  /** Every statement that failed; import keeps going past failures */
  errors: ImportError[];
}
