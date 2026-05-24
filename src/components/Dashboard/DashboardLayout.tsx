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

  // Tab / table state
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);

  // Row inspector state
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [showInspector, setShowInspector] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const connectionId = connection?.config.id ?? null;
  const activeDatabase =
    connection?.activeDatabase ?? connection?.config.defaultDatabase ?? connection?.databases[0] ?? null;

  // Data queries
  const { data: tables = [], isLoading: tablesLoading } = useListTables(connectionId);
  const { data: queryResult = null, isLoading: rowsLoading } = useFetchRows(connectionId, activeTable);

  const handleTableClick = (name: string) => {
    setActiveTable(name);
    setSelectedRowIndex(null);
    if (!openTabs.includes(name)) {
      setOpenTabs((prev) => [...prev, name]);
    }
  };

  const handleTabChange = (name: string) => {
    setActiveTable(name);
    setSelectedRowIndex(null);
  };

  const handleTabClose = (name: string) => {
    const newTabs = openTabs.filter((t) => t !== name);
    setOpenTabs(newTabs);
    if (activeTable === name) {
      setActiveTable(newTabs[newTabs.length - 1] ?? null);
      setSelectedRowIndex(null);
    }
  };

  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;

  useHotkeys("meta+1,meta+2,meta+3,meta+4,meta+5,meta+6,meta+7,meta+8,meta+9", (e) => {
    const tab = openTabsRef.current[parseInt(e.key) - 1];
    if (tab) handleTabChange(tab);
  });
  useHotkeys("meta+w", (e) => {
    e.preventDefault();
    if (activeTable) handleTabClose(activeTable);
  });

  const handleRowClick = (index: number) => {
    setSelectedRowIndex(index);
  };

  const handleInspectRow = (index: number) => {
    setSelectedRowIndex(index);
    setShowInspector(true);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["rows", connectionId, activeTable] });
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
          activeTable={activeTable}
          onTableClick={handleTableClick}
          sidebarOpen={sidebarOpen}
        />

        {/* Content */}
        <ContentArea
          openTabs={openTabs}
          activeTable={activeTable}
          onTabChange={handleTabChange}
          onTabClose={handleTabClose}
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
