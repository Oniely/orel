import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useConnectionStore } from "../../stores/connection.store";
import { useListTables, useFetchRows } from "../../hooks/useTables";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ContentArea } from "./ContentArea";
import { RowInspector } from "./RowInspector";
import { useHotkeys } from "react-hotkeys-hook";
import type { Tab } from "../../types/database";

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

  // Tab state
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;
  const activeTableName = activeTab?.type === "table" ? activeTab.label : null;

  // Row inspector state
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const connectionId = connection?.config.id ?? null;
  const activeDatabase =
    connection?.activeDatabase ?? connection?.config.defaultDatabase ?? connection?.databases[0] ?? null;

  // Data queries
  const { data: tables = [], isLoading: tablesLoading } = useListTables(connectionId);
  const { data: queryResult = null, isLoading: rowsLoading } = useFetchRows(connectionId, activeTableName);

  const handleTableClick = (name: string) => {
    const id = `t-${name}`;
    if (!openTabs.find((t) => t.id === id)) {
      setOpenTabs((prev) => [...prev, { id, type: "table", label: name }]);
    }
    setActiveTabId(id);
    setSelectedRowIndex(null);
  };

  const handleTabChange = (id: string) => {
    setActiveTabId(id);
    setSelectedRowIndex(null);
  };

  const handleTabClose = (id: string) => {
    const idx = openTabs.findIndex((t) => t.id === id);
    const newTabs = openTabs.filter((t) => t.id !== id);
    setOpenTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[Math.max(0, idx - 1)]?.id ?? null);
      setSelectedRowIndex(null);
    }
  };

  const handleNewQuery = () => {
    const id = `q-${Date.now()}`;
    setOpenTabs((prev) => {
      const n = prev.filter((t) => t.type === "query").length + 1;
      return [...prev, { id, type: "query", label: `Query ${n}`, sql: "" }];
    });
    setActiveTabId(id);
  };

  const handleSqlChange = (id: string, sql: string) => {
    setOpenTabs((prev) => prev.map((t) => (t.id === id ? { ...t, sql } : t)));
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

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["rows", connectionId, activeTableName] });
    queryClient.invalidateQueries({ queryKey: ["tables", connectionId] });
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
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
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
