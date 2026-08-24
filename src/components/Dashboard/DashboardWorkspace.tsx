import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { RowContextMenu } from "./DataGrid/RowContextMenu";
import { WriteQueueFooter } from "./DataGrid/WriteQueueFooter";
import { FilterBar } from "./DataGrid/FilterBar";
import { DataGrid } from "./DataGrid/DataGrid";
import { TableStatusFooter } from "./DataGrid/TableWorkspaceFooter";
import { StructurePanel } from "./TableStructure/StructurePanel";
import { useDashboardStore, DEFAULT_FILTER_ROW } from "../../stores/dashboard.store";
import { useDashboardContext } from "../../hooks/dashboard/useDashboardContext";
import { useActiveTable } from "../../hooks/dashboard/useActiveTable";
import { TabStrip } from "./Tabs/TabStrip";
import { SqlWorkspace } from "./SqlEditor/SqlWorkspace";

export function DashboardWorkspace() {
  const { activeTab, activeTableName, connectionId, activeDatabase, scopeKey } = useDashboardContext();
  const { queryResult, error, totalResults, totalPages, page, limit, setPage, writeQueue: wq } = useActiveTable();
  const {
    setSelectedRowIndex,
    showInspector,
    setShowInspector,
    filters,
    setFilters,
    applyFilters,
    clearFilters,
    showFilterBar,
    setShowFilterBar,
    activeView,
    setActiveView,
    contextMenu,
    setContextMenu,
  } = useDashboardStore(
    useShallow((s) => ({
      setSelectedRowIndex: s.setSelectedRowIndex,
      showInspector: s.showInspector,
      setShowInspector: s.setShowInspector,
      filters: s.tableFilters[scopeKey ?? ""]?.staged ?? DEFAULT_FILTER_ROW,
      setFilters: s.setFilters,
      applyFilters: s.applyFilters,
      clearFilters: s.clearFilters,
      showFilterBar: !!s.showFilterBar[scopeKey ?? ""],
      setShowFilterBar: s.setShowFilterBar,
      activeView: s.activeView,
      setActiveView: s.setActiveView,
      contextMenu: s.contextMenu,
      setContextMenu: s.setContextMenu,
    })),
  );
  const isQueryTab = activeTab?.type === "query";
  // Reset to Data view whenever the active table changes
  useEffect(() => {
    setActiveView("Data");
  }, [activeTableName, setActiveView]);

  const columns = error ? [] : (queryResult?.columns ?? []);
  const rows = error ? [] : (queryResult?.rows ?? []);

  const firstCol = columns[0]?.name ?? "";

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      <TabStrip />

      {isQueryTab ? (
        <SqlWorkspace />
      ) : activeView === "Data" ? (
        <>
          {showFilterBar && (
            <FilterBar
              filters={filters.map((f) => ({ ...f, col: f.col || firstCol }))}
              columns={
                columns.length > 0
                  ? columns
                  : [{ name: "column", dataType: "text", isNullable: true, isPrimary: false, hasDefault: false }]
              }
              onFiltersChange={(newFilters) => {
                if (newFilters.length === 0) {
                  clearFilters(scopeKey);
                  setShowFilterBar(scopeKey, false);
                } else {
                  setFilters(scopeKey, newFilters);
                }
              }}
              onApply={() => applyFilters(scopeKey)}
            />
          )}
          <DataGrid />
          {contextMenu && (
            <RowContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onInspect={() => {
                setSelectedRowIndex(contextMenu.rowIndex);
                setShowInspector(true);
                setContextMenu(null);
              }}
              onDeleteRow={
                wq.hasPrimaryKey
                  ? () => {
                      wq.handleDeleteRow(contextMenu.rowIndex);
                      setContextMenu(null);
                    }
                  : undefined
              }
              isRowDeleted={wq.isRowDeleted(contextMenu.rowIndex)}
              onUndoDelete={
                wq.hasPrimaryKey
                  ? () => {
                      wq.handleUndoDeleteRow(contextMenu.rowIndex);
                      setContextMenu(null);
                    }
                  : undefined
              }
              onClose={() => setContextMenu(null)}
            />
          )}
        </>
      ) : (
        <StructurePanel connectionId={connectionId} database={activeDatabase} activeTable={activeTableName} />
      )}

      {/* Write queue footer — only when there are pending changes */}
      {!isQueryTab && wq.changeCount > 0 && !showInspector && (
        <WriteQueueFooter
          changeCount={wq.changeCount}
          onReset={wq.handleReset}
          onApply={wq.handleApply}
          onCopySql={wq.handleCopySql}
          isApplying={wq.isApplying}
        />
      )}

      <TableStatusFooter
        activeTable={activeTableName}
        activeView={activeView}
        onViewChange={setActiveView}
        rowCount={rows.length}
        totalResults={totalResults}
        totalPages={totalPages}
        page={page}
        limit={limit}
        onPageChange={setPage}
      />
    </div>
  );
}
