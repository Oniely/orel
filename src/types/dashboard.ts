import type { SqlEditorState } from "./editor";

export interface TableTab {
  id: string;
  type: "table";
  label: string;
}

export interface QueryTab {
  id: string;
  type: "query";
  label: string;
  sql: string;
  editorState: SqlEditorState;
}

export type DashboardTab = TableTab | QueryTab;

export interface DashboardTabState {
  tabs: DashboardTab[];
  activeTabId: string | null;
}

export type DashboardView = "Data" | "Structure";

export interface RowContextMenuState {
  rowIndex: number;
  x: number;
  y: number;
}

export type NavigationIntent =
  | { kind: "close-tab"; databaseKey: string; tabId: string }
  | { kind: "switch-database"; connectionId: string; database: string }
  | { kind: "disconnect"; connectionId: string };

export interface TransactionGuardState {
  editorIds: string[];
  title: string;
  description: string;
  intent: NavigationIntent;
}
