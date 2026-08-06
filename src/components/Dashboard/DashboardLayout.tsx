import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useConnectionStore } from "../../stores/connection.store";
import { useListDatabases, useSwitchDatabase, useDisconnect } from "../../hooks/useConnections";
import { databaseQueryKeys, useListTables, useFetchRows } from "../../hooks/useTables";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ContentArea } from "./ContentArea";
import { RowInspector } from "./RowInspector";
import { useHotkeys, type Options as HotkeyOptions } from "react-hotkeys-hook";
import { listen } from "@tauri-apps/api/event";
import type { Tab } from "../../types/database";
import { createSqlEditorState, type SqlEditorState } from "../../types/editor";
import { useWriteQueueActions } from "../../hooks/useWriteQueueActions";
import { AlertDialog, Button, Spinner, toast } from "@heroui/react";
import { getErrorMessage } from "../../lib/error";
import { useCommitEditorTransaction, useRollbackEditorTransaction } from "../../hooks/useSqlEditor";

type TabState = { tabs: Tab[]; activeTabId: string | null };
type TransactionGuard = {
  editorIds: string[];
  title: string;
  description: string;
  onResolved: () => void;
};
const EMPTY_TAB_STATE: TabState = { tabs: [], activeTabId: null };
const APP_HOTKEY_OPTIONS: HotkeyOptions = {
  preventDefault: true,
  enableOnFormTags: true,
  enableOnContentEditable: true,
  eventListenerOptions: { capture: true },
};

export function DashboardLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { focusedConnectionId, activeConnections } = useConnectionStore();
  const connection = focusedConnectionId ? activeConnections[focusedConnectionId] : null;

  // Tab State - Record Map
  const [tabState, setTabState] = useState<Record<string, TabState>>({});

  // Row inspector state
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [transactionGuard, setTransactionGuard] = useState<TransactionGuard | null>(null);
  const commitEditorTransaction = useCommitEditorTransaction();
  const rollbackEditorTransaction = useRollbackEditorTransaction();

  const connectionId = connection?.config.id ?? null;
  const activeDatabase =
    connection?.activeDatabase ?? connection?.config.defaultDatabase ?? connection?.databases[0] ?? null;
  const databaseKey = connectionId && activeDatabase ? `${connectionId}::${activeDatabase}` : "__none__"; // combining connectionId and activeDatabase (this way even if activeDatabse name is the same on other connection it'll not render the same tabs as they have different connectionId)

  const { tabs: openTabs, activeTabId } = tabState[databaseKey] ?? EMPTY_TAB_STATE;
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;
  const activeTableName = activeTab?.type === "table" ? activeTab.label : null;
  const activeEditorOperationPending = activeTab?.type === "query" && activeTab.editorState?.operationPending === true;

  const blockPendingEditorNavigation = () => {
    if (!activeEditorOperationPending) return false;
    toast.warning("Wait for the current editor operation to finish before leaving this query tab");
    return true;
  };

  // Data queries
  useListDatabases(connectionId, connection?.status === "connected"); // Load databases of connectionId
  const switchDatabase = useSwitchDatabase();
  const disconnect = useDisconnect();
  const { data: tables = [], isLoading: tablesLoading, error: tablesError } = useListTables(
    connectionId,
    activeDatabase,
  );
  const {
    data: queryResult = null,
    isLoading: rowsInitialLoading,
    isFetching: rowsFetching,
    error: rowsError,
  } = useFetchRows(connectionId, activeDatabase, activeTableName);
  const rowsLoading = rowsInitialLoading || rowsFetching;

  const updateTabState = (updater: (state: TabState) => TabState) =>
    setTabState((prev) => ({
      ...prev,
      [databaseKey]: updater(prev[databaseKey] ?? EMPTY_TAB_STATE),
    }));

  const handleTableClick = (name: string) => {
    if (blockPendingEditorNavigation()) return;
    const id = `t-${name}`;
    updateTabState((state) => {
      if (state.tabs.some((t) => t.id === id)) {
        return { ...state, activeTabId: id };
      }
      return { tabs: [...state.tabs, { id, type: "table", label: name }], activeTabId: id };
    });
    setSelectedRowIndex(null);
  };

  const handleTabChange = (id: string) => {
    if (id !== activeTabId && blockPendingEditorNavigation()) return;
    updateTabState((state) => ({ ...state, activeTabId: id }));
    setSelectedRowIndex(null);
  };

  const closeTabNow = (id: string) => {
    updateTabState((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id);
      const nextTabs = state.tabs.filter((t) => t.id !== id);
      const nextActive = state.activeTabId === id ? (nextTabs[Math.max(0, idx - 1)]?.id ?? null) : state.activeTabId;
      return { tabs: nextTabs, activeTabId: nextActive };
    });
    if (activeTabId === id) {
      setSelectedRowIndex(null);
    }
  };

  const handleTabClose = (id: string) => {
    if (id === activeTabId && blockPendingEditorNavigation()) return;
    const tab = openTabs.find((candidate) => candidate.id === id);
    if (tab?.editorState?.transactionState && tab.editorState.transactionState !== "inactive") {
      setTransactionGuard({
        editorIds: [id],
        title: "Close query with an active transaction?",
        description: "Commit or roll back the transaction before closing this query tab.",
        onResolved: () => closeTabNow(id),
      });
      return;
    }
    closeTabNow(id);
  };

  // new query tab (sql editor)
  const handleNewQuery = () => {
    if (blockPendingEditorNavigation()) return;
    const id = `q-${Date.now()}`;
    updateTabState((state) => {
      const n = state.tabs.filter((t) => t.type === "query").length + 1;
      return {
        tabs: [...state.tabs, { id, type: "query", label: `Query ${n}`, sql: "", editorState: createSqlEditorState() }],
        activeTabId: id,
      };
    });
  };

  // sql query state for saving sql query text
  const handleSqlChange = (id: string, sql: string) => {
    updateTabState((state) => ({
      ...state,
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    }));
  };

  const handleEditorStateChange = (id: string, editorState: SqlEditorState) => {
    updateTabState((state) => ({
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, editorState } : tab)),
    }));
  };

  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const cycleTab = (direction: 1 | -1): void => {
    const tabs = openTabsRef.current;
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeTabIdRef.current);
    handleTabChange(tabs[(idx + direction + tabs.length) % tabs.length].id);
  };

  useHotkeys(
    "mod+1,mod+2,mod+3,mod+4,mod+5,mod+6,mod+7,mod+8,mod+9",
    (event) => {
      event.stopPropagation();
      const tab = openTabsRef.current[Number(event.code.slice(-1)) - 1];
      if (tab) handleTabChange(tab.id);
    },
    APP_HOTKEY_OPTIONS,
    [databaseKey],
  );
  useHotkeys(
    "mod+t",
    (event) => {
      event.stopPropagation();
      if (!event.repeat) handleNewQuery();
    },
    APP_HOTKEY_OPTIONS,
    [databaseKey],
  );
  useHotkeys(
    "mod+w",
    (event) => {
      event.stopPropagation();
      const tabId = activeTabIdRef.current;
      if (!event.repeat && tabId) handleTabClose(tabId);
    },
    APP_HOTKEY_OPTIONS,
    [databaseKey],
  );
  useHotkeys(
    "ctrl+tab",
    (event) => {
      event.preventDefault();
      cycleTab(1);
    },
    [databaseKey],
  );
  useHotkeys(
    "ctrl+shift+tab",
    (event) => {
      event.preventDefault();
      cycleTab(-1);
    },
    [databaseKey],
  );
  useHotkeys("alt+z", () => setSidebarOpen((v) => !v));

  const handleRowClick = (index: number) => {
    setSelectedRowIndex(index);
  };

  const handleInspectRow = (index: number) => {
    setSelectedRowIndex(index);
    setShowInspector(true);
  };

  const switchDatabaseNow = (database: string) => {
    if (!connectionId || !database || database === activeDatabase) return;
    setSelectedRowIndex(null);
    setShowInspector(false);
    switchDatabase.mutate(
      { connectionId, database },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: databaseQueryKeys.rowsForDatabase(connectionId, database) });
          queryClient.invalidateQueries({ queryKey: databaseQueryKeys.tables(connectionId, database) });
        },
      },
    );
  };

  const activeEditorIdsForKeys = (keys: string[]) => keys.flatMap((key) =>
    (tabState[key]?.tabs ?? [])
      .filter((tab) => tab.editorState?.transactionState && tab.editorState.transactionState !== "inactive")
      .map((tab) => tab.id),
  );

  const handleDatabaseSelect = (database: string) => {
    if (!connectionId || !database || database === activeDatabase) return;
    if (blockPendingEditorNavigation()) return;
    const editorIds = activeEditorIdsForKeys([databaseKey]);
    if (editorIds.length > 0) {
      setTransactionGuard({
        editorIds,
        title: "Resolve transactions before switching database",
        description: "Each active query transaction must be committed or rolled back before Orel can replace the database pool.",
        onResolved: () => switchDatabaseNow(database),
      });
      return;
    }
    switchDatabaseNow(database);
  };

  const disconnectNow = () => {
    if (connectionId)
      disconnect.mutate(connectionId, {
        onSuccess: () => {
          navigate({ to: "/" });
        },
      });
  };

  const handleDisconnect = () => {
    if (!connectionId) return;
    if (blockPendingEditorNavigation()) return;
    const connectionKeys = Object.keys(tabState).filter((key) => key.startsWith(`${connectionId}::`));
    const editorIds = activeEditorIdsForKeys(connectionKeys);
    if (editorIds.length > 0) {
      setTransactionGuard({
        editorIds,
        title: "Resolve transactions before disconnecting",
        description: "Choose whether to commit or roll back each active query transaction before disconnecting.",
        onResolved: disconnectNow,
      });
      return;
    }
    disconnectNow();
  };

  const markEditorTransactionInactive = (editorId: string) => {
    setTabState((previous) => Object.fromEntries(
      Object.entries(previous).map(([key, value]) => [
        key,
        {
          ...value,
          tabs: value.tabs.map((tab) => tab.id === editorId && tab.editorState
            ? { ...tab, editorState: { ...tab.editorState, transactionState: "inactive" as const } }
            : tab),
        },
      ]),
    ));
  };

  const resolveGuardTransaction = (editorId: string, action: "commit" | "rollback") => {
    if (!transactionGuard) return;
    const mutation = action === "commit" ? commitEditorTransaction : rollbackEditorTransaction;
    mutation.mutate(editorId, {
      onSuccess: () => {
        markEditorTransactionInactive(editorId);
        if (action === "commit") handleRefresh();
        toast.success(action === "commit" ? "Transaction committed" : "Transaction rolled back");
        const remaining = transactionGuard.editorIds.filter((id) => id !== editorId);
        if (remaining.length === 0) {
          const onResolved = transactionGuard.onResolved;
          setTransactionGuard(null);
          onResolved();
        } else {
          setTransactionGuard({ ...transactionGuard, editorIds: remaining });
        }
      },
      onError: (error) => toast.danger(getErrorMessage(error, `Failed to ${action} transaction`)),
    });
  };

  const handleRefresh = useCallback(() => {
    if (connectionId && activeDatabase) {
      queryClient.refetchQueries({
        queryKey: databaseQueryKeys.rowsForDatabase(connectionId, activeDatabase),
      });
      queryClient.refetchQueries({ queryKey: databaseQueryKeys.tables(connectionId, activeDatabase) });
    }
    queryClient.refetchQueries({ queryKey: databaseQueryKeys.databases(connectionId) });
  }, [queryClient, connectionId, activeDatabase]);

  useHotkeys(
    "mod+r",
    (event) => {
      event.stopPropagation();
      handleRefresh();
    },
    APP_HOTKEY_OPTIONS,
    [handleRefresh],
  );

  // Listen for native menu refresh event (Cmd+R)
  useEffect(() => {
    const unlisten = listen("refresh", () => handleRefresh());
    return () => { unlisten.then((fn) => fn()); };
  }, [handleRefresh]);

  const rows = rowsError ? [] : (queryResult?.rows ?? []);
  const columns = queryResult?.columns ?? [];
  const selectedRow = selectedRowIndex !== null ? (rows[selectedRowIndex] as Record<string, unknown>) : null;

  // ── Write Queue ──────────────────────────────────────────────────────────
  const scopeKey = databaseKey !== "__none__" && activeTableName ? `${databaseKey}::${activeTableName}` : null;

  const wq = useWriteQueueActions(
    scopeKey,
    connectionId,
    activeDatabase,
    activeTableName,
    rowsError ? null : queryResult,
  );

  useHotkeys(
    "mod+s",
    (event) => {
      event.stopPropagation();
      if (showInspector && selectedRowIndex !== null) {
        wq.handleApplyRow(selectedRowIndex).then((applied) => {
          if (applied) toast.success("Row saved");
        });
      } else {
        wq.handleApply();
      }
    },
    APP_HOTKEY_OPTIONS,
    [wq, showInspector, selectedRowIndex],
  );
  useHotkeys(
    "mod+shift+s",
    (event) => {
      event.stopPropagation();
      wq.handleCopySql();
    },
    APP_HOTKEY_OPTIONS,
    [wq],
  );

  if (!connection) return null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <Header
        connection={connection}
        activeDatabase={activeDatabase}
        showInspector={showInspector}
        onToggleInspector={() => setShowInspector((v) => !v)}
        onRefresh={handleRefresh}
        onDatabaseSelect={handleDatabaseSelect}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onDisconnect={handleDisconnect}
        onAddRow={wq.handleAddRow}
      />

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <Sidebar
          tables={tables}
          isLoading={tablesLoading}
          error={tablesError ? getErrorMessage(tablesError, "Failed to load tables") : null}
          activeTable={activeTableName}
          onTableClick={handleTableClick}
          onNewQuery={handleNewQuery}
          sidebarOpen={sidebarOpen}
          onDisconnect={handleDisconnect}
        />

        {/* Content */}
        <ContentArea
          connectionId={connection.config.id}
          openTabs={openTabs}
          activeTabId={activeTabId}
          onTabChange={handleTabChange}
          onTabClose={handleTabClose}
          onNewQuery={handleNewQuery}
          onSqlChange={handleSqlChange}
          onEditorStateChange={handleEditorStateChange}
          onEditorDataChanged={handleRefresh}
          queryResult={queryResult}
          isLoading={rowsLoading}
          error={rowsError ? getErrorMessage(rowsError, "Failed to load rows") : null}
          selectedRowIndex={selectedRowIndex}
          onRowClick={handleRowClick}
          onInspectRow={handleInspectRow}
          wq={wq}
          showInspector={showInspector}
        />

        {/* Row Inspector */}
        {showInspector && (
          <RowInspector
            row={selectedRow}
            columns={columns}
            rowIndex={selectedRowIndex ?? 0}
            totalRows={rows.length}
            onPrev={() => setSelectedRowIndex((i) => Math.max(0, (i ?? 0) - 1))}
            onNext={() => setSelectedRowIndex((i) => Math.min(rows.length - 1, (i ?? 0) + 1))}
            onClose={() => setShowInspector(false)}
            wq={wq}
          />
        )}
      </div>

      <AlertDialog>
        <AlertDialog.Backdrop
          isOpen={transactionGuard !== null}
          isDismissable={!commitEditorTransaction.isPending && !rollbackEditorTransaction.isPending}
          isKeyboardDismissDisabled={commitEditorTransaction.isPending || rollbackEditorTransaction.isPending}
          onOpenChange={(open) => { if (!open) setTransactionGuard(null); }}
        >
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>{transactionGuard?.title}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>{transactionGuard?.description}</p>
                <div className="mt-4 space-y-2">
                  {transactionGuard?.editorIds.map((editorId) => {
                    const guardedTab = Object.values(tabState).flatMap((value) => value.tabs).find((tab) => tab.id === editorId);
                    const failed = guardedTab?.editorState?.transactionState === "failed";
                    const pending = commitEditorTransaction.isPending || rollbackEditorTransaction.isPending;
                    return (
                      <div key={editorId} className="flex items-center gap-2 rounded-lg border border-separator bg-surface-secondary p-2.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{guardedTab?.label ?? editorId}</span>
                        <Button size="sm" variant="danger-soft" isDisabled={pending} onClick={() => resolveGuardTransaction(editorId, "rollback")}>
                          {rollbackEditorTransaction.isPending ? <Spinner size="sm" /> : "Rollback"}
                        </Button>
                        <Button size="sm" isDisabled={pending || failed} onClick={() => resolveGuardTransaction(editorId, "commit")}>
                          {commitEditorTransaction.isPending ? <Spinner size="sm" /> : "Commit"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="outline" isDisabled={commitEditorTransaction.isPending || rollbackEditorTransaction.isPending} onClick={() => setTransactionGuard(null)}>Cancel</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
