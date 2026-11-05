import { useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { SIDEBAR_PAD } from "../shared/constants";
import { ResizeHandle } from "../shared/ResizeHandle";
import { useLayoutStore } from "../../../stores/layout.store";
import { EyeIcon, MeteorIcon, PicnicTableIcon, PlusIcon } from "@phosphor-icons/react";
import { Button, SearchField, toast } from "@heroui/react";
import { formatNum } from "../../../lib/format";

import { useDropTables, useListTables } from "../../../hooks/useTables";
import { getErrorMessage } from "../../../lib/error";
import { useDashboardStore, useDashboardStoreApi } from "../../../stores/dashboard.store";
import { useDashboardCommands } from "../../../hooks/dashboard/useDashboardCommands";
import { useDashboardContext } from "../../../hooks/dashboard/useDashboardContext";
import { ConfirmDeleteDialog } from "../../shared/ConfirmDeleteDialog";
import { TableContextMenu } from "./TableContextMenu";
import { nextTableSelection, type TableSelection } from "./tableSelection";

// Selection and staged deletes belong to one database; a different key means they're stale.
interface SidebarTableState extends TableSelection {
  databaseKey: string;
  staged: string[];
}

export function Sidebar() {
  const [search, setSearch] = useState("");
  const { connectionId, activeDatabase, activeTableName, databaseKey } = useDashboardContext();
  const sidebarOpen = useDashboardStore((state) => state.sidebarOpen);
  const sidebarWidth = useLayoutStore((state) => state.sidebarWidth);
  const setSidebarWidth = useLayoutStore((state) => state.setSidebarWidth);
  const commands = useDashboardCommands();
  const store = useDashboardStoreApi();
  const dropTables = useDropTables();
  const { data: tables = [], isLoading, error: tablesError } = useListTables(connectionId, activeDatabase);
  const error = tablesError ? getErrorMessage(tablesError, "Failed to load tables") : null;

  const [tableState, setTableState] = useState<SidebarTableState>({
    databaseKey,
    selected: [],
    anchor: null,
    staged: [],
  });
  const [menu, setMenu] = useState<{ x: number; y: number; targets: string[] } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const visibleTables = error ? [] : tables;
  const filtered = visibleTables.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const tableList = filtered.filter((t) => t.tableType === "table");
  const viewList = filtered.filter((t) => t.tableType === "view");

  const current =
    tableState.databaseKey === databaseKey ? tableState : { databaseKey, selected: [], anchor: null, staged: [] };
  const tableNames = new Set(visibleTables.filter((t) => t.tableType === "table").map((t) => t.name));
  const selected = current.selected.filter((name) => tableNames.has(name));
  const staged = current.staged.filter((name) => tableNames.has(name));

  const updateTableState = (patch: Partial<SidebarTableState>) => setTableState({ ...current, ...patch });
  const stage = (names: string[]) => updateTableState({ staged: [...new Set([...staged, ...names])] });
  const unstage = (names: string[]) => updateTableState({ staged: staged.filter((name) => !names.includes(name)) });

  const handleTableClick = (e: MouseEvent, name: string) => {
    const click = { name, toggle: e.metaKey || e.ctrlKey, range: e.shiftKey };
    const next = nextTableSelection(current, click, tableList.map((t) => t.name));
    updateTableState(next);
    if (!click.toggle && !click.range) commands.openTable(name);
  };

  const handleListKeyDown = (e: KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selected.length > 0) {
      e.preventDefault();
      stage(selected);
    }
  };

  const handleListContextMenu = (e: MouseEvent) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>("[data-table-name]")?.dataset.tableName;
    if (!name) return;
    e.preventDefault();
    const targets = selected.includes(name) ? selected : [name];
    if (!selected.includes(name)) updateTableState({ selected: [name], anchor: name });
    setMenu({ x: e.clientX, y: e.clientY, targets });
  };

  const handleConfirmDelete = () => {
    if (!connectionId || !activeDatabase) return;
    dropTables.mutate(
      { connectionId, database: activeDatabase, tables: staged },
      {
        onSuccess: () => {
          for (const name of staged) store.getState().closeTab(databaseKey, `t-${name}`);
          updateTableState({ selected: [], anchor: null, staged: [] });
          setConfirmOpen(false);
          toast.success(staged.length === 1 ? `Table "${staged[0]}" deleted` : `${staged.length} tables deleted`);
        },
      },
    );
  };

  return (
    <div
      className="relative flex flex-col shrink-0 border-r border-separator bg-surface text-surface-foreground"
      style={{ width: sidebarOpen ? sidebarWidth : "auto", display: sidebarOpen ? "flex" : "none" }}
    >
      <ResizeHandle side="right" width={sidebarWidth} onResize={setSidebarWidth} />
      {/* Search */}
      <div style={{ padding: `12px ${SIDEBAR_PAD}px 8px` }}>
        <SearchField
          aria-label="Search tables"
          value={search}
          onChange={setSearch}
          style={{ width: "100%" }}
          variant="secondary"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search…" className="text-xs font-medium" />
            <SearchField.ClearButton className="-ml-4" />
          </SearchField.Group>
        </SearchField>
      </div>

      {/* Tables section header */}
      <div className="flex items-center justify-between px-2.5 py-1">
        <span className="px-2.5 py-1 text-muted text-xs font-medium">Tables</span>
        <span className="px-2.5 py-1 text-muted text-xs font-mono">{isLoading ? "…" : tableList.length}</span>
      </div>

      {/* Table list */}
      <div
        className="flex-1 overflow-y-auto px-2 py-2 scrollbar-hide"
        onKeyDownCapture={handleListKeyDown}
        onContextMenu={handleListContextMenu}
      >
        {isLoading && <div className="px-3 py-4 text-center text-xs text-muted">Loading…</div>}

        {!isLoading && error && <div className="px-3 py-4 text-center text-xs text-danger">{error}</div>}

        {!isLoading && !error && tableList.length === 0 && !search && (
          <div className="px-3 py-4 text-center text-xs text-muted">No tables</div>
        )}

        {tableList.map((t) => {
          const isActive = activeTableName === t.name;
          const isSelected = selected.includes(t.name);
          const isStaged = staged.includes(t.name);
          return (
            <Button
              key={t.name}
              data-table-name={t.name}
              onClick={(e) => handleTableClick(e, t.name)}
              className="flex items-center text-left gap-2.5 w-full h-[34px] px-2.5 mb-0.5"
              style={{
                background: isActive
                  ? "color-mix(in oklch, var(--accent) 18%, transparent)"
                  : isSelected
                    ? "color-mix(in oklch, var(--accent) 9%, transparent)"
                    : "transparent",
              }}
            >
              <PicnicTableIcon
                size={14}
                style={{
                  color: isStaged ? "var(--danger)" : isActive ? "var(--accent)" : "var(--muted)",
                  opacity: isActive || isStaged ? 1 : 0.4,
                }}
              />
              <span
                className={`flex-1 font-mono text-[12px] truncate ${isStaged ? "line-through" : ""}`}
                style={{ color: isStaged ? "var(--danger)" : isActive ? "var(--accent)" : "var(--foreground)" }}
              >
                {t.name}
              </span>
              {t.rowEstimate !== null && (
                <span className="text-xs text-muted font-mono shrink-0">{formatNum(t.rowEstimate)}</span>
              )}
            </Button>
          );
        })}

        {/* Views */}
        {viewList.length > 0 && (
          <>
            <div className="px-2.5 py-1 text-muted text-xs font-medium mt-3">Views</div>
            {viewList.map((t) => (
              <Button
                key={t.name}
                onClick={() => commands.openTable(t.name)}
                className="flex items-center gap-2.5 w-full h-[34px] px-2.5 text-left mb-[1px]"
              >
                <EyeIcon size={11} className="text-muted opacity-70 shrink-0" />
                <span className="flex-1 font-mono text-[12px] truncate text-foreground">{t.name}</span>
              </Button>
            ))}
          </>
        )}
      </div>

      {/* Staged table deletes */}
      {staged.length > 0 && (
        <div
          className="border-t border-separator flex items-center gap-2"
          style={{ padding: `8px ${SIDEBAR_PAD}px` }}
        >
          <span className="flex-1 text-xs text-danger truncate">
            {staged.length === 1 ? "1 table" : `${staged.length} tables`} to delete
          </span>
          <Button size="sm" variant="tertiary" className="text-xs h-7" onPress={() => updateTableState({ staged: [] })}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" className="text-xs h-7" onPress={() => setConfirmOpen(true)}>
            Delete
          </Button>
        </div>
      )}

      {/* Bottom: New query button */}
      <div
        className="border-t border-separator flex items-center flex-row-reverse gap-2 py-2.5 h-14"
        style={{ padding: `10px ${SIDEBAR_PAD}px` }}
      >
        <Button variant="tertiary" onClick={commands.openQuery} className="text-xs flex-1">
          <PlusIcon className="size-3" weight="bold" />
          New query
        </Button>
        <Button variant="danger-soft" onClick={commands.disconnect}>
          <MeteorIcon className="size-4" />
        </Button>
      </div>

      {menu && (
        <TableContextMenu
          x={menu.x}
          y={menu.y}
          count={menu.targets.length}
          isStaged={menu.targets.every((name) => staged.includes(name))}
          onStageDelete={() => {
            stage(menu.targets);
            setMenu(null);
          }}
          onUndoDelete={() => {
            unstage(menu.targets);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      <ConfirmDeleteDialog
        isOpen={confirmOpen}
        title={staged.length === 1 ? "Delete table?" : `Delete ${staged.length} tables?`}
        isPending={dropTables.isPending}
        errorMessage={dropTables.isError ? getErrorMessage(dropTables.error, "Failed to delete tables") : null}
        onCancel={() => {
          setConfirmOpen(false);
          dropTables.reset();
        }}
        onConfirm={handleConfirmDelete}
      >
        This permanently deletes{" "}
        {staged.map((name, i) => (
          <span key={name}>
            {i > 0 && ", "}
            <ConfirmDeleteDialog.Name>{name}</ConfirmDeleteDialog.Name>
          </span>
        ))}{" "}
        and all of {staged.length === 1 ? "its" : "their"} data. This action cannot be undone.
      </ConfirmDeleteDialog>
    </div>
  );
}
