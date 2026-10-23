export interface ExportSummary {
  tablesExported: number;
  viewsExported: number;
  rowsExported: number;
  filePath: string;
}

export interface ImportSummary {
  statementsExecuted: number;
  tablesAffected: number;
}

/** What import_sql_dump rejects with — an object, not a plain string */
export interface ImportError {
  message: string;
  /** 1-indexed line of the failing statement */
  line: number | null;
  /** Up to ~200 chars of the failing statement */
  snippet: string | null;
  /** Plain-language hint when the dump looks like it's for another database */
  hint: string | null;
}
