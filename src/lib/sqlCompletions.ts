import type { Monaco } from "@monaco-editor/react";
import type { QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { databaseQueryKeys } from "../hooks/useTables";
import type { StructureColumn, TableInfo } from "../types/database";
import type { TableStructure } from "../types/database";

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT INTO",
  "UPDATE",
  "DELETE FROM",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "FULL JOIN",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS NULL",
  "IS NOT NULL",
  "IN",
  "LIKE",
  "BETWEEN",
  "DISTINCT",
  "VALUES",
  "SET",
  "INTO",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "DEFAULT",
  "UNIQUE",
  "INDEX",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "UNION",
  "UNION ALL",
  "EXISTS",
  "ASC",
  "DESC",
];

const SQL_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "NOW",
  "CAST",
  "CONCAT",
  "LOWER",
  "UPPER",
  "LENGTH",
  "ROUND",
  "SUBSTRING",
];

export interface SqlCompletionContext {
  queryClient: QueryClient;
  connectionId: string | null;
  database: string | null;
}

let sharedContext: SqlCompletionContext = { queryClient: null as unknown as QueryClient, connectionId: null, database: null };
let providerRegistered = false;

/** Updates the connection/database the shared completion provider reads from; call on every tab switch. */
export function setSqlCompletionContext(context: SqlCompletionContext) {
  sharedContext = context;
}

async function fetchTables(context: SqlCompletionContext): Promise<TableInfo[]> {
  if (!context.connectionId || !context.database) return [];
  try {
    return await context.queryClient.fetchQuery({
      queryKey: databaseQueryKeys.tables(context.connectionId, context.database),
      queryFn: () => invoke<TableInfo[]>("list_tables", { connectionId: context.connectionId! }),
      staleTime: 30_000,
    });
  } catch {
    return [];
  }
}

async function fetchColumns(context: SqlCompletionContext, table: string): Promise<StructureColumn[]> {
  if (!context.connectionId || !context.database) return [];
  try {
    const structure = await context.queryClient.fetchQuery({
      queryKey: databaseQueryKeys.tableStructure(context.connectionId, context.database, table),
      queryFn: () =>
        invoke<TableStructure>("fetch_table_structure", { connectionId: context.connectionId!, table }),
      staleTime: 30_000,
    });
    return structure.columns;
  } catch {
    return [];
  }
}

const NON_ALIAS_KEYWORDS = new Set(["WHERE", "ON", "GROUP", "ORDER", "LIMIT", "HAVING", "SET", "VALUES"]);

interface MinimalPosition {
  lineNumber: number;
  column: number;
}

/** Narrow structural slice of monaco.editor.ITextModel we actually need; avoids a monaco-editor type dep. */
interface MinimalTextModel {
  getValueInRange(range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }): string;
  getWordUntilPosition(position: MinimalPosition): { startColumn: number; endColumn: number; word: string };
  getValue(): string;
}

/** Maps alias (or bare table name) -> table name for every FROM/JOIN clause found in the SQL text. */
export function findReferencedTables(sql: string): Map<string, string> {
  const refs = new Map<string, string>();
  const pattern = /\b(?:FROM|JOIN)\s+([a-zA-Z_][\w.]*)(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    const table = match[1].split(".").pop()!;
    refs.set(table, table);
    const alias = match[2];
    if (alias && !NON_ALIAS_KEYWORDS.has(alias.toUpperCase())) {
      refs.set(alias, table);
    }
  }
  return refs;
}

/** Registers the "sql" language completion provider once; safe to call on every editor mount. */
export function ensureSqlCompletionProvider(monaco: Monaco) {
  if (providerRegistered) return;
  providerRegistered = true;

  const provider: Parameters<Monaco["languages"]["registerCompletionItemProvider"]>[1] = {
    triggerCharacters: [".", " "],
    provideCompletionItems: async (model: MinimalTextModel, position: MinimalPosition) => {
      const context = sharedContext;
      const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const wordInfo = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn,
      };

      // "alias." / "table." -> only that table's columns
      const dotMatch = /([a-zA-Z_]\w*)\.(\w*)$/.exec(textUntilPosition);
      if (dotMatch) {
        const refs = findReferencedTables(model.getValue());
        const tableName = refs.get(dotMatch[1]) ?? dotMatch[1];
        const columns = await fetchColumns(context, tableName);
        return {
          suggestions: columns.map((col) => ({
            label: col.name,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: col.dataType,
            insertText: col.name,
            range,
          })),
        };
      }

      const refs = findReferencedTables(model.getValue());
      const [tables, columnSuggestions] = await Promise.all([
        fetchTables(context),
        Promise.all(
          [...new Set(refs.values())].map((table) =>
            fetchColumns(context, table).then((cols) => cols.map((col) => ({ table, col }))),
          ),
        ).then((groups) => groups.flat()),
      ]);

      return {
        suggestions: [
          ...SQL_KEYWORDS.map((keyword) => ({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            range,
          })),
          ...SQL_FUNCTIONS.map((fn) => ({
            label: fn,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `${fn}()`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
          ...tables.map((table) => ({
            label: table.name,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: table.tableType,
            insertText: table.name,
            range,
          })),
          ...columnSuggestions.map(({ table, col }) => ({
            label: col.name,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `${table} · ${col.dataType}`,
            insertText: col.name,
            range,
          })),
        ],
      };
    },
  };

  monaco.languages.registerCompletionItemProvider("sql", provider);
}
