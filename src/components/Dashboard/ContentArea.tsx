import { useEffect, useMemo, useState } from "react";
import { RowContextMenu } from "./RowContextMenu";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import type { ColumnInfo, FilterOperator, FilterRow, QueryResult, Tab } from "../../types/database";
import { KeyIcon } from "./icons";
import { Button } from "@heroui/react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  CodeSimpleIcon,
  MagnifyingGlassIcon,
  PicnicTableIcon,
  PlusIcon,
  XIcon,
  CodeIcon,
} from "@phosphor-icons/react";

import { getTypeColor } from "../../lib/typeColors";
import { formatNum } from "../../lib/format";
import { SqlEditor, type SqlEditorCommands } from "./SqlEditor";

// ── Cell renderer ─────────────────────────────────────────────────────────────

function Cell({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted italic text-[11px] text-muted">NULL</span>;
  }
  const color = getTypeColor(type);
  const isBool = type === "boolean" || type === "bool";
  if (isBool || typeof value === "boolean") {
    const bool = value === true || value === "true" || value === 1;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-[2px]"
          style={{ background: bool ? "var(--success)" : "var(--muted)" }}
        />
        <span className="font-mono text-xs" style={{ color }}>
          {bool ? "true" : "false"}
        </span>
      </span>
    );
  }
  if (typeof value === "string" && value.startsWith("http")) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <img src={value} className="w-4 h-4 rounded-full object-cover" alt="" />
        <span className="font-mono text-[11px] truncate" style={{ color }}>
          {value.slice(0, 32)}…
        </span>
      </span>
    );
  }
  return (
    <span className="font-mono text-xs" style={{ color }}>
      {String(value)}
    </span>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const OP_OPTIONS: FilterOperator[] = [
  "equals",
  "not equals",
  "contains",
  "starts with",
  "in",
  "not in",
  ">",
  "<",
  ">=",
  "<=",
  "is null",
  "is not null",
];

interface FilterBarProps {
  filters: FilterRow[];
  columns: ColumnInfo[];
  onFiltersChange: (filters: FilterRow[]) => void;
  onApply: () => void;
}

function FilterBar({ filters, columns, onFiltersChange, onApply }: FilterBarProps) {
  const addFilter = () =>
    onFiltersChange([...filters, { col: columns[0]?.name ?? "", op: "equals", val: "", conjunction: "AND" }]);
  const toggleConjunction = (i: number) =>
    onFiltersChange(
      filters.map((f, idx) => (idx === i ? { ...f, conjunction: f.conjunction === "AND" ? "OR" : "AND" } : f)),
    );
  const removeFilter = (i: number) => onFiltersChange(filters.filter((_, idx) => idx !== i));
  const updateFilter = (i: number, key: keyof FilterRow, val: string) =>
    onFiltersChange(filters.map((f, idx) => (idx === i ? { ...f, [key]: val } : f)));

  return (
    <div className="border-b border-separator bg-surface px-4.5 py-2.5">
      {filters.map((f, i) => (
        <div key={i} className={`flex items-center gap-2${i !== filters.length - 1 ? " mb-1.5" : ""}`}>
          {/* Conjunction prefix — CodeIcon for filter #1, AND/OR toggle for the rest */}
          {i === 0 ? (
            <div className="w-9 h-[30px] grid place-items-center rounded-[6px] bg-surface-secondary border border-separator text-muted shrink-0">
              <CodeSimpleIcon size={12} />
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => toggleConjunction(i)}
              className="w-9 h-[30px] grid place-items-center rounded-[6px] text-[10px] font-semibold font-mono"
            >
              {f.conjunction}
            </Button>
          )}

          {/* Column dropdown */}
          <div className="h-[30px] rounded-[6px] bg-surface-secondary border border-separator flex items-center min-w-[180px]">
            <select
              value={f.col}
              onChange={(e) => updateFilter(i, "col", e.target.value)}
              className="db-select text-(--accent) flex-1"
            >
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Operator dropdown */}
          <div className="h-[30px] w-[130px] rounded-[6px] bg-surface-secondary border border-separator flex items-center shrink-0">
            <select
              value={f.op}
              onChange={(e) => updateFilter(i, "op", e.target.value as FilterOperator)}
              className="db-select text-muted flex-1"
            >
              {OP_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          {/* Value input */}
          <div className="flex-1 h-[30px] rounded-[6px] bg-surface-secondary border border-separator flex items-center px-3 min-w-0">
            <input
              value={f.val}
              onChange={(e) => updateFilter(i, "val", e.target.value)}
              placeholder="value"
              className="flex-1 bg-transparent border-none outline-none text-foreground text-xs font-mono min-w-0 placeholder:text-muted"
            />
            {f.val && (
              <Button isIconOnly variant="ghost" onClick={() => updateFilter(i, "val", "")} className="size-5">
                <XIcon className="size-2.5" />
              </Button>
            )}
          </div>

          {/* Row controls */}
          <Button
            variant="danger-soft"
            onClick={() => removeFilter(i)}
            isDisabled={filters.length === 1}
            className="size-[30px] grid place-items-center shrink-0"
            isIconOnly
          >
            <XIcon className="size-3" />
          </Button>
          <Button variant="outline" onClick={addFilter} className="size-[30px] grid place-items-center" isIconOnly>
            <PlusIcon className="size-3" />
          </Button>

          {/* Apply button — only on last row */}
          {i === filters.length - 1 ? (
            <Button onClick={onApply} className="size-[30px] grid place-items-center" isIconOnly>
              <MagnifyingGlassIcon className="size-3" />
            </Button>
          ) : (
            <div className="w-[30px]" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Data Grid ─────────────────────────────────────────────────────────────────

interface DataGridProps {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  selectedRowIndex: number | null;
  onRowClick: (index: number) => void;
  onRowContextMenu: (index: number, x: number, y: number) => void;
  isLoading: boolean;
  activeTable: string | null;
}

function DataGrid({
  columns: colInfos,
  rows,
  selectedRowIndex,
  onRowClick,
  onRowContextMenu,
  isLoading,
  activeTable,
}: DataGridProps) {
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        id: "__row_number",
        size: 52,
        minSize: 52,
        enableResizing: false,
        header: () => null,
        cell: ({ row }) => <span className="font-mono text-[11px] text-muted select-none">{row.index + 1}</span>,
      },
      ...colInfos.map((c) => ({
        id: c.name,
        accessorKey: c.name,
        size: 210,
        minSize: 60,
        header: () => (
          <div className="flex items-center gap-1.5 overflow-hidden">
            {c.isPrimary && <KeyIcon size={9} className="text-warning shrink-0" />}
            <span className="font-mono text-foreground shrink-0">{c.name}</span>
            <span
              className="text-[9px] font-mono px-1 py-[1px] rounded min-w-0 truncate"
              style={{
                color: getTypeColor(c.dataType),
                background: `color-mix(in oklch, ${getTypeColor(c.dataType)} 12%, transparent)`,
              }}
            >
              {c.dataType}
            </span>
          </div>
        ),
        cell: ({ getValue }: any) => <Cell value={getValue()} type={c.dataType} />,
      })),
    ],
    [colInfos],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
  });

  if (!activeTable) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Select a table to view its data</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-background scrollbar-hide">
      <table className="border-collapse text-xs table-fixed min-w-full" style={{ width: table.getTotalSize() }}>
        <colgroup>
          {table.getHeaderGroups()[0]?.headers.map((header) => (
            <col key={header.id} style={{ width: header.getSize() }} />
          ))}
        </colgroup>

        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="sticky top-0 z-[1] bg-background">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="text-left relative select-none whitespace-nowrap overflow-hidden font-medium text-[11px] px-3.5 py-2.5 border-b-hairline"
                  style={{ width: header.getSize() }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}

                  {/* Resize handle */}
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-[2] group"
                  >
                    <div
                      className="absolute right-px top-[20%] bottom-[20%] w-0.5 rounded-[1px] transition-opacity duration-150 group-hover:opacity-100"
                      style={{
                        background: header.column.getIsResizing() ? "var(--accent)" : "var(--separator)",
                        opacity: header.column.getIsResizing() ? 1 : 0.4,
                      }}
                    />
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>

        <tbody>
          {table.getRowModel().rows.map((row, i) => (
            <tr
              key={row.id}
              onClick={() => onRowClick(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                onRowContextMenu(i, e.clientX, e.clientY);
              }}
              className="cursor-pointer transition-colors h-10"
              style={{
                background:
                  selectedRowIndex === i ? "color-mix(in oklch, var(--accent) 10%, transparent)" : "transparent",
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className="border-b-hairline px-[14px] overflow-hidden whitespace-nowrap"
                  style={{ maxWidth: cell.column.getSize() }}
                >
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={colInfos.length} className="text-center py-12 text-sm text-muted">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Pill Tab Bar ──────────────────────────────────────────────────────────────

interface PillTabBarProps<T extends string> {
  tabs: readonly T[];
  active: T;
  onChange: (tab: T) => void;
}

function PillTabBar<T extends string>({ tabs, active, onChange }: PillTabBarProps<T>) {
  return (
    <div className="flex p-0.5 rounded-[7px] border border-separator bg-surface-secondary">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className="px-2.5 py-[3px] rounded-[5px] text-[11px] transition-colors font-sans"
          style={{
            background: active === t ? "var(--surface)" : "transparent",
            color: active === t ? "var(--foreground)" : "var(--muted)",
            fontWeight: active === t ? 500 : 400,
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ── Structure Panel ────────────────────────────────────────────────────────────

const STRUCTURE_TABS = ["Columns", "Indexes", "Foreign Keys", "DDL"] as const;
type StructureTabType = (typeof STRUCTURE_TABS)[number];

interface StructurePanelProps {
  columns: ColumnInfo[];
  activeTable: string | null;
}

function StructurePanel({ activeTable }: StructurePanelProps) {
  const [activeTab, setActiveTab] = useState<StructureTabType>("Columns");

  if (!activeTable) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Select a table to view its structure</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Sub-tab strip */}
      <div className="flex items-center px-4.5 h-10 border-b border-separator bg-surface shrink-0">
        <PillTabBar tabs={STRUCTURE_TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto bg-background">
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted">{activeTab} — coming soon</p>
        </div>
      </div>
    </div>
  );
}

// ── Content Area (tabs + filter + grid + footer) ──────────────────────────────

const VIEWS = ["Data", "Structure"] as const;
type ViewType = (typeof VIEWS)[number];

interface ContentAreaProps {
  openTabs: Tab[];
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewQuery: () => void;
  onSqlChange: (id: string, sql: string) => void;
  queryResult: QueryResult | null;
  isLoading: boolean;
  selectedRowIndex: number | null;
  onRowClick: (index: number) => void;
  onInspectRow: (index: number) => void;
}

export function ContentArea({
  openTabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onNewQuery,
  onSqlChange,
  queryResult,
  isLoading,
  selectedRowIndex,
  onRowClick,
  onInspectRow,
}: ContentAreaProps) {
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;
  const isQueryTab = activeTab?.type === "query";
  const activeTableName = activeTab?.type === "table" ? activeTab.label : null;

  const [filters, setFilters] = useState<FilterRow[]>([
    { col: queryResult?.columns[0]?.name ?? "", op: "equals", val: "", conjunction: "AND" },
  ]);
  const [activeView, setActiveView] = useState<ViewType>("Data");
  const [contextMenu, setContextMenu] = useState<{ rowIndex: number; x: number; y: number } | null>(null);

  // Reset to Data view whenever the active table changes
  useEffect(() => {
    setActiveView("Data");
  }, [activeTableName]);

  const columns = queryResult?.columns ?? [];
  const rows = queryResult?.rows ?? [];
  const totalEstimate = queryResult?.totalEstimate ?? null;

  const firstCol = columns[0]?.name ?? "";

  const cycleTab = (direction: 1 | -1): void => {
    if (openTabs.length < 2) return;
    const idx = openTabs.findIndex((t) => t.id === activeTabId);
    onTabChange(openTabs[(idx + direction + openTabs.length) % openTabs.length].id);
  };

  const editorCommands: SqlEditorCommands = {
    closeTab: () => activeTab && onTabClose(activeTab.id),
    newQuery: onNewQuery,
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    switchTab: (index) => {
      const t = openTabs[index];
      if (t) onTabChange(t.id);
    },
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      {/* Browser-style tabs */}
      <div className="h-10 flex items-center gap-1 px-3 border-b border-separator bg-surface shrink-0">
        {openTabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          return (
            <div
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="flex items-center gap-2 px-3 h-7 rounded-lg cursor-pointer text-xs font-mono transition-colors"
              style={{
                background: isActive ? "var(--surface-secondary)" : "transparent",
                border: isActive
                  ? "1px solid color-mix(in oklch, var(--separator) 60%, transparent)"
                  : "1px solid transparent",
                color: isActive ? "var(--foreground)" : "var(--muted)",
              }}
            >
              {tab.type === "query" ? (
                <CodeIcon
                  size={11}
                  className="opacity-60 shrink-0"
                  style={{ color: isActive ? "var(--accent)" : undefined, opacity: isActive ? 1 : 0.6 }}
                />
              ) : (
                <PicnicTableIcon size={11} className="opacity-60 shrink-0" />
              )}
              <span>{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className="w-4 h-4 grid place-items-center rounded-[3px] opacity-50 hover:opacity-100 transition-opacity"
              >
                <XIcon size={10} />
              </button>
            </div>
          );
        })}
        <Button size="sm" variant="ghost" onClick={onNewQuery} className="ml-0.5" isIconOnly>
          <PlusIcon className="size-3" />
        </Button>
      </div>

      {isQueryTab && activeTab ? (
        <SqlEditor
          key={activeTab.id}
          sql={activeTab.sql ?? ""}
          onSqlChange={(sql) => onSqlChange(activeTab.id, sql)}
          commands={editorCommands}
        />
      ) : activeView === "Data" ? (
        <>
          <FilterBar
            filters={filters.map((f) => ({ ...f, col: f.col || firstCol }))}
            columns={
              columns.length > 0 ? columns : [{ name: "column", dataType: "text", isNullable: true, isPrimary: false }]
            }
            onFiltersChange={setFilters}
            onApply={() => {
              /* TODO: apply filters to query */
            }}
          />
          <DataGrid
            columns={columns}
            rows={rows}
            selectedRowIndex={selectedRowIndex}
            onRowClick={onRowClick}
            onRowContextMenu={(index, x, y) => setContextMenu({ rowIndex: index, x, y })}
            isLoading={isLoading}
            activeTable={activeTableName}
          />
          {contextMenu && (
            <RowContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onInspect={() => {
                onInspectRow(contextMenu.rowIndex);
                setContextMenu(null);
              }}
              onClose={() => setContextMenu(null)}
            />
          )}
        </>
      ) : (
        <StructurePanel columns={columns} activeTable={activeTableName} />
      )}

      {/* Footer */}
      {!isQueryTab && (
        <div className="flex items-center justify-between gap-4 px-4.5 border-t border-separator bg-surface shrink-0 font-mono text-muted h-9.5 text-[11px]">
          {/* View switcher */}
          <PillTabBar tabs={VIEWS} active={activeView} onChange={setActiveView} />

          {/* Pagination — center, only in Data view */}
          {activeView === "Data" && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" className="size-5" isIconOnly>
                <CaretLeftIcon className="size-2.5" />
              </Button>
              <span>1</span>
              <Button variant="ghost" className="size-5" isIconOnly>
                <CaretRightIcon className="size-2.5" />
              </Button>
            </div>
          )}

          {/* Row count — right side, only in Data view */}
          {activeView === "Data" && (
            <span>
              <span className="text-foreground">{rows.length}</span>
              {totalEstimate !== null && <span> / {formatNum(totalEstimate)}</span>} rows
            </span>
          )}
        </div>
      )}
    </div>
  );
}
