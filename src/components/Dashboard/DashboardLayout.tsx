import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useConnectionStore } from "../../stores/connection.store";
import { useListDatabases, useSwitchDatabase, useDisconnect } from "../../hooks/useConnections";
import { useListTables, useFetchRows } from "../../hooks/useTables";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ContentArea } from "./ContentArea";
import { RowInspector } from "./RowInspector";
import { useHotkeys } from "react-hotkeys-hook";
import type { Tab } from "../../types/database";

type TabState = { tabs: Tab[]; activeTabId: string | null };
const EMPTY_TAB_STATE: TabState = { tabs: [], activeTabId: null };

export function DashboardLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { focusedConnectionId, activeConnections } = useConnectionStore();
  const connection = focusedConnectionId ? activeConnections[focusedConnectionId] : null;

  // Redirect if no active connection
  useEffect(() => {
    if (!connection) {
      navigate({ to: "/" });
    }
  }, [connection, navigate]);

  // Tab State - Record Map
  const [tabState, setTabState] = useState<Record<string, TabState>>({});

  // Row inspector state
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const connectionId = connection?.config.id ?? null;
  const activeDatabase =
    connection?.activeDatabase ?? connection?.config.defaultDatabase ?? connection?.databases[0] ?? null;
  const databaseKey = connectionId && activeDatabase ? `${connectionId}::${activeDatabase}` : "__none__"; // combining connectionId and activeDatabase (this way even if activeDatabse name is the same on other connection it'll not render the same tabs as they have different connectionId)

  const { tabs: openTabs, activeTabId } = tabState[databaseKey] ?? EMPTY_TAB_STATE;
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;
  const activeTableName = activeTab?.type === "table" ? activeTab.label : null;

  // Data queries
  useListDatabases(connectionId, connection?.status === "connected"); // Load databases of connectionId
  const switchDatabase = useSwitchDatabase();
  const disconnect = useDisconnect();
  const { data: tables = [], isLoading: tablesLoading } = useListTables(connectionId);
  const { data: queryResult = null, isLoading: rowsLoading } = useFetchRows(connectionId, activeTableName);

  const updateTabState = (updater: (state: TabState) => TabState) =>
    setTabState((prev) => ({
      ...prev,
      [databaseKey]: updater(prev[databaseKey] ?? EMPTY_TAB_STATE),
    }));

  const handleTableClick = (name: string) => {
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
    updateTabState((state) => ({ ...state, activeTabId: id }));
    setSelectedRowIndex(null);
  };

  const handleTabClose = (id: string) => {
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

  // new query tab (sql editor)
  const handleNewQuery = () => {
    const id = `q-${Date.now()}`;
    updateTabState((state) => {
      const n = state.tabs.filter((t) => t.type === "query").length + 1;
      return { tabs: [...state.tabs, { id, type: "query", label: `Query ${n}`, sql: "" }], activeTabId: id };
    });
  };

  // sql query state for saving sql query text
  const handleSqlChange = (id: string, sql: string) => {
    updateTabState((state) => ({
      ...state,
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    }));
  };

  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Dashboard Layout Shortcuts - Tab Switching
  useHotkeys("meta+1,meta+2,meta+3,meta+4,meta+5,meta+6,meta+7,meta+8,meta+9", (e) => {
    const tab = openTabsRef.current[parseInt(e.key) - 1];
    if (tab) handleTabChange(tab.id);
  });
  useHotkeys("meta+w", (e) => {
    e.preventDefault();
    if (activeTabId) handleTabClose(activeTabId);
  });
  useHotkeys("meta+t", (e) => {
    e.preventDefault();
    handleNewQuery();
  });
  const cycleTab = (direction: 1 | -1): void => {
    const tabs = openTabsRef.current;
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((t) => t.id === activeTabIdRef.current);
    handleTabChange(tabs[(idx + direction + tabs.length) % tabs.length].id);
  };
  useHotkeys("ctrl+tab", (e) => {
    e.preventDefault();
    cycleTab(1);
  });
  useHotkeys("ctrl+shift+tab", (e) => {
    e.preventDefault();
    cycleTab(-1);
  });

  const handleRowClick = (index: number) => {
    setSelectedRowIndex(index);
  };

  const handleInspectRow = (index: number) => {
    setSelectedRowIndex(index);
    setShowInspector(true);
  };

  const handleDatabaseSelect = (database: string) => {
    if (!connectionId || !database || database === activeDatabase) return;
    setSelectedRowIndex(null);
    setShowInspector(false);
    switchDatabase.mutate(
      { connectionId, database },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["rows", connectionId] });
          queryClient.invalidateQueries({ queryKey: ["tables", connectionId] });
        },
      },
    );
  };

  const handleDisconnect = () => {
    if (connectionId)
      disconnect.mutate(connectionId, {
        onSuccess: () => {
          navigate({ to: "/" });
        },
      });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["rows", connectionId, activeTableName] });
    queryClient.invalidateQueries({ queryKey: ["tables", connectionId] });
    queryClient.invalidateQueries({ queryKey: ["databases", connectionId] });
  };

  const rows = queryResult?.rows ?? [];
  const columns = queryResult?.columns ?? [];
  const selectedRow = selectedRowIndex !== null ? (rows[selectedRowIndex] as Record<string, unknown>) : null;

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
      />

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <Sidebar
          tables={tables}
          isLoading={tablesLoading}
          activeTable={activeTableName}
          onTableClick={handleTableClick}
          onNewQuery={handleNewQuery}
          sidebarOpen={sidebarOpen}
        />

        {/* Content */}
        <ContentArea
          openTabs={openTabs}
          activeTabId={activeTabId}
          onTabChange={handleTabChange}
          onTabClose={handleTabClose}
          onNewQuery={handleNewQuery}
          onSqlChange={handleSqlChange}
          queryResult={queryResult}
          isLoading={rowsLoading}
          selectedRowIndex={selectedRowIndex}
          onRowClick={handleRowClick}
          onInspectRow={handleInspectRow}
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
          />
        )}
      </div>
    </div>
  );
}
