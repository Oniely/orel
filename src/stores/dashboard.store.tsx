import { createContext, useContext, useRef, type ReactNode } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { FilterRow } from "../types/database";
import type { DashboardTabState, DashboardView, RowContextMenuState, TransactionGuardState } from "../types/dashboard";
import type { SqlEditorState } from "../types/editor";
import { createSqlEditorState } from "../types/editor";

const EMPTY_TAB_STATE: DashboardTabState = { tabs: [], activeTabId: null };

export interface TablePagination {
  page: number;
  limit: number;
}

export interface TableFilterState {
  staged: FilterRow[];
  applied: FilterRow[];
}

export const EMPTY_FILTER_STATE: TableFilterState = { staged: [], applied: [] };
export const DEFAULT_PAGINATION: TablePagination = { page: 1, limit: 100 };
export const DEFAULT_FILTER_ROW: FilterRow[] = [{ col: "", op: "equals", val: "", conjunction: "AND" }];

export interface DashboardState {
  tabState: Record<string, DashboardTabState>;
  selectedRowIndex: number | null;
  showInspector: boolean;
  sidebarOpen: boolean;
  tableFilters: Record<string, TableFilterState>;
  tablePagination: Record<string, TablePagination>;
  showFilterBar: Record<string, boolean>;
  activeView: DashboardView;
  contextMenu: RowContextMenuState | null;
  transactionGuard: TransactionGuardState | null;

  openTable: (databaseKey: string, name: string) => void;
  openQuery: (databaseKey: string) => void;
  activateTab: (databaseKey: string, id: string) => void;
  closeTab: (databaseKey: string, id: string) => void;
  updateSql: (databaseKey: string, id: string, sql: string) => void;
  updateEditorState: (databaseKey: string, id: string, editorState: SqlEditorState) => void;
  markEditorTransactionInactive: (editorId: string) => void;
  setSelectedRowIndex: (index: number | null) => void;
  setShowInspector: (show: boolean) => void;
  toggleInspector: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setFilters: (scopeKey: string | null, filters: FilterRow[]) => void;
  applyFilters: (scopeKey: string | null) => void;
  clearFilters: (scopeKey: string | null) => void;
  setShowFilterBar: (scopeKey: string | null, show: boolean) => void;
  toggleFilterBar: (scopeKey: string | null) => void;
  setPage: (scopeKey: string | null, page: number) => void;
  setLimit: (scopeKey: string | null, limit: number) => void;
  setActiveView: (view: DashboardView) => void;
  setContextMenu: (menu: RowContextMenuState | null) => void;
  setTransactionGuard: (guard: TransactionGuardState | null) => void;
}

function updateTabs(
  state: DashboardState,
  databaseKey: string,
  updater: (current: DashboardTabState) => DashboardTabState,
): Pick<DashboardState, "tabState"> {
  return {
    tabState: {
      ...state.tabState,
      [databaseKey]: updater(state.tabState[databaseKey] ?? EMPTY_TAB_STATE),
    },
  };
}

/**
 * `zustand/vanilla` is the framework-agnostic Zustand API, not a legacy version.
 * It lets DashboardStoreProvider create one store instance per dashboard mount,
 * instead of a module-level singleton whose UI state would survive route unmounts.
 * React components subscribe to this instance through `useStore` below.
 */
export function createDashboardStore(): StoreApi<DashboardState> {
  return createStore<DashboardState>((set) => ({
    tabState: {},
    selectedRowIndex: null,
    showInspector: false,
    sidebarOpen: true,
    tableFilters: {},
    tablePagination: {},
    showFilterBar: {},
    activeView: "Data",
    contextMenu: null,
    transactionGuard: null,

    openTable: (databaseKey, name) =>
      set((state) => ({
        ...updateTabs(state, databaseKey, (current) => {
          const id = `t-${name}`;
          if (current.tabs.some((tab) => tab.id === id)) {
            return { ...current, activeTabId: id };
          }
          return {
            tabs: [...current.tabs, { id, type: "table", label: name }],
            activeTabId: id,
          };
        }),
        selectedRowIndex: null,
      })),
    openQuery: (databaseKey) =>
      set((state) =>
        updateTabs(state, databaseKey, (current) => {
          const id = `q-${Date.now()}`;
          const queryNumber = current.tabs.filter((tab) => tab.type === "query").length + 1;
          return {
            tabs: [
              ...current.tabs,
              {
                id,
                type: "query",
                label: `Query ${queryNumber}`,
                sql: "",
                editorState: createSqlEditorState(),
              },
            ],
            activeTabId: id,
          };
        }),
      ),
    activateTab: (databaseKey, id) =>
      set((state) => ({
        ...updateTabs(state, databaseKey, (current) => ({ ...current, activeTabId: id })),
        selectedRowIndex: null,
      })),
    closeTab: (databaseKey, id) =>
      set((state) => ({
        ...updateTabs(state, databaseKey, (current) => {
          const index = current.tabs.findIndex((tab) => tab.id === id);
          const tabs = current.tabs.filter((tab) => tab.id !== id);
          return {
            tabs,
            activeTabId: current.activeTabId === id ? (tabs[Math.max(0, index - 1)]?.id ?? null) : current.activeTabId,
          };
        }),
        selectedRowIndex: state.tabState[databaseKey]?.activeTabId === id ? null : state.selectedRowIndex,
      })),
    updateSql: (databaseKey, id, sql) =>
      set((state) =>
        updateTabs(state, databaseKey, (current) => ({
          ...current,
          tabs: current.tabs.map((tab) => (tab.id === id && tab.type === "query" ? { ...tab, sql } : tab)),
        })),
      ),
    updateEditorState: (databaseKey, id, editorState) =>
      set((state) =>
        updateTabs(state, databaseKey, (current) => ({
          ...current,
          tabs: current.tabs.map((tab) => (tab.id === id && tab.type === "query" ? { ...tab, editorState } : tab)),
        })),
      ),
    markEditorTransactionInactive: (editorId) =>
      set((state) => ({
        tabState: Object.fromEntries(
          Object.entries(state.tabState).map(([key, value]) => [
            key,
            {
              ...value,
              tabs: value.tabs.map((tab) =>
                tab.id === editorId && tab.type === "query"
                  ? {
                      ...tab,
                      editorState: { ...tab.editorState, transactionState: "inactive" },
                    }
                  : tab,
              ),
            },
          ]),
        ),
      })),
    setSelectedRowIndex: (selectedRowIndex) => set({ selectedRowIndex }),
    setShowInspector: (showInspector) => set({ showInspector }),
    toggleInspector: () => set((state) => ({ showInspector: !state.showInspector })),
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setFilters: (scopeKey, filters) =>
      scopeKey
        ? set((state) => ({
            tableFilters: {
              ...state.tableFilters,
              [scopeKey]: { ...(state.tableFilters[scopeKey] ?? { applied: [] }), staged: filters },
            },
          }))
        : undefined,
    clearFilters: (scopeKey) =>
      scopeKey
        ? set((state) => ({
            tableFilters: { ...state.tableFilters, [scopeKey]: { staged: [], applied: [] } },
            tablePagination: {
              ...state.tablePagination,
              [scopeKey]: { ...(state.tablePagination[scopeKey] ?? { limit: 100 }), page: 1 },
            },
          }))
        : undefined,
    applyFilters: (scopeKey) =>
      scopeKey
        ? set((state) => ({
            tableFilters: {
              ...state.tableFilters,
              [scopeKey]: {
                staged: state.tableFilters[scopeKey]?.staged ?? [],
                applied: state.tableFilters[scopeKey]?.staged ?? [],
              },
            },
            tablePagination: {
              ...state.tablePagination,
              [scopeKey]: { ...(state.tablePagination[scopeKey] ?? { limit: 100 }), page: 1 },
            },
          }))
        : undefined,
    setShowFilterBar: (scopeKey, show) =>
      scopeKey ? set((state) => ({ showFilterBar: { ...state.showFilterBar, [scopeKey]: show } })) : undefined,
    toggleFilterBar: (scopeKey) =>
      scopeKey
        ? set((state) => ({ showFilterBar: { ...state.showFilterBar, [scopeKey]: !state.showFilterBar[scopeKey] } }))
        : undefined,
    setPage: (scopeKey, page) =>
      scopeKey
        ? set((state) => ({
            tablePagination: {
              ...state.tablePagination,
              [scopeKey]: { ...(state.tablePagination[scopeKey] ?? { limit: 100 }), page },
            },
          }))
        : undefined,
    setLimit: (scopeKey, limit) =>
      scopeKey
        ? set((state) => ({
            tablePagination: {
              ...state.tablePagination,
              [scopeKey]: { page: 1, limit },
            },
          }))
        : undefined,
    setActiveView: (activeView) => set({ activeView }),
    setContextMenu: (contextMenu) => set({ contextMenu }),
    setTransactionGuard: (transactionGuard) => set({ transactionGuard }),
  }));
}

// Build Context & Provider
const DashboardStoreContext = createContext<StoreApi<DashboardState> | null>(null);

export function DashboardStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<DashboardState> | null>(null);
  if (!storeRef.current) storeRef.current = createDashboardStore();

  // prettier-ignore
  return (
    <DashboardStoreContext.Provider value={storeRef.current}>
      {children}
    </DashboardStoreContext.Provider>
  );
}

/** Read a value from the store. The component re-renders whenever that value changes. */
export function useDashboardStore<T>(selector: (state: DashboardState) => T): T {
  const store = useContext(DashboardStoreContext);
  if (!store) throw new Error("useDashboardStore must be used within DashboardStoreProvider");
  return useStore(store, selector);
}

/** Get the store instance to read or write state inside a callback, without causing a re-render. */
export function useDashboardStoreApi(): StoreApi<DashboardState> {
  const store = useContext(DashboardStoreContext);
  if (!store) throw new Error("useDashboardStoreApi must be used within DashboardStoreProvider");
  return store;
}

export function getDatabaseTabs(state: DashboardState, databaseKey: string): DashboardTabState {
  return state.tabState[databaseKey] ?? EMPTY_TAB_STATE;
}

export function getActiveEditorIds(state: DashboardState, databaseKeys: string[]): string[] {
  return databaseKeys.flatMap((key) =>
    (state.tabState[key]?.tabs ?? [])
      .filter((tab) => tab.type === "query" && tab.editorState.transactionState !== "inactive")
      .map((tab) => tab.id),
  );
}
