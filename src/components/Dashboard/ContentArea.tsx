import { useMemo, useState } from "react";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import type { ColumnInfo, FilterOperator, FilterRow, QueryResult } from "../../types/database";
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
} from "@phosphor-icons/react";

// ── Type colors ───────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  uuid: "oklch(72% 0.12 290)",
  varchar: "oklch(74% 0.12 220)",
  "character varying": "oklch(74% 0.12 220)",
  text: "oklch(74% 0.12 220)",
  boolean: "oklch(74% 0.13 30)",
  bool: "oklch(74% 0.13 30)",
  timestamp: "oklch(76% 0.13 150)",
  "timestamp with time zone": "oklch(76% 0.13 150)",
  timestamptz: "oklch(76% 0.13 150)",
  integer: "oklch(78% 0.12 100)",
  int: "oklch(78% 0.12 100)",
  int4: "oklch(78% 0.12 100)",
  bigint: "oklch(78% 0.12 100)",
  int8: "oklch(78% 0.12 100)",
  jsonb: "oklch(74% 0.12 330)",
  json: "oklch(74% 0.12 330)",
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? "oklch(70% 0.02 273)";
}

function formatNum(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function Cell({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) {
    return <span className="text-default-400 italic text-[11px]">NULL</span>;
  }
  const isBool = type === "boolean" || type === "bool";
  if (isBool || typeof value === "boolean") {
    const bool = value === true || value === "true" || value === 1;
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-[2px]"
          style={{ background: bool ? "oklch(73% 0.18 153)" : "oklch(60% 0.02 273)" }}
        />
        <span className="font-mono text-xs">{bool ? "true" : "false"}</span>
      </span>
    );
  }
  if (typeof value === "string" && value.startsWith("http")) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <img src={value} className="w-4 h-4 rounded-full object-cover" alt="" />
        <span className="font-mono text-[11px] text-default-400 truncate">{value.slice(0, 32)}…</span>
      </span>
    );
  }
  return <span className="font-mono text-xs">{String(value)}</span>;
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
            <div className="w-9 h-[30px] grid place-items-center rounded-[6px] bg-surface-secondary border border-separator text-default-400 shrink-0">
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
              className="flex-1 bg-transparent border-none outline-none text-foreground text-xs font-mono min-w-0 placeholder:text-default-400"
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
  isLoading: boolean;
  activeTable: string | null;
}

function DataGrid({ columns: colInfos, rows, selectedRowIndex, onRowClick, isLoading, activeTable }: DataGridProps) {
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      colInfos.map((c) => ({
        id: c.name,
        accessorKey: c.name,
        size: 210,
        minSize: 60,
        header: () => (
          <div className="flex items-center gap-1.5 overflow-hidden">
            {c.isPrimary && <KeyIcon size={9} className="text-[oklch(76%_0.13_60)] shrink-0" />}
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
        cell: ({ getValue }) => <Cell value={getValue()} type={c.dataType} />,
      })),
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
        <p className="text-sm text-default-400">Select a table to view its data</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-default-400">Loading…</p>
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
              <td colSpan={colInfos.length} className="text-center py-12 text-sm text-default-400">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Content Area (tabs + filter + grid + footer) ──────────────────────────────

const VIEWS = ["Data", "Structure", "Indexes", "Foreign Keys"] as const;
type ViewType = (typeof VIEWS)[number];

interface ContentAreaProps {
  openTabs: string[];
  activeTable: string | null;
  onTabChange: (table: string) => void;
  onTabClose: (table: string) => void;
  queryResult: QueryResult | null;
  isLoading: boolean;
  selectedRowIndex: number | null;
  onRowClick: (index: number) => void;
}

export function ContentArea({
  openTabs,
  activeTable,
  onTabChange,
  onTabClose,
  queryResult,
  isLoading,
  selectedRowIndex,
  onRowClick,
}: ContentAreaProps) {
  const [filters, setFilters] = useState<FilterRow[]>([
    { col: queryResult?.columns[0]?.name ?? "", op: "equals", val: "", conjunction: "AND" },
  ]);
  const [activeView, setActiveView] = useState<ViewType>("Data");

  const columns = queryResult?.columns ?? [];
  const rows = queryResult?.rows ?? [];
  const totalEstimate = queryResult?.totalEstimate ?? null;

  // Sync first filter col when columns change
  const firstCol = columns[0]?.name ?? "";

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      {/* Browser-style tabs */}
      <div className="h-10 flex items-center gap-1 px-3 border-b border-separator bg-surface shrink-0">
        {openTabs.map((tab) => {
          const isActive = activeTable === tab;
          return (
            <div
              key={tab}
              onClick={() => onTabChange(tab)}
              className="flex items-center gap-2 px-3 h-7 rounded-lg cursor-pointer text-xs font-mono transition-colors"
              style={{
                background: isActive ? "var(--surface-secondary)" : "transparent",
                border: isActive
                  ? "1px solid color-mix(in oklch, var(--separator) 60%, transparent)"
                  : "1px solid transparent",
                color: isActive ? "var(--foreground)" : "var(--muted)",
              }}
            >
              <PicnicTableIcon size={11} className="opacity-60 shrink-0" />
              <span>{tab}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab);
                }}
                className="w-4 h-4 grid place-items-center rounded-[3px] opacity-50 hover:opacity-100 transition-opacity"
              >
                <XIcon size={10} />
              </button>
            </div>
          );
        })}
        <Button size="sm" variant="ghost" className="ml-0.5" isIconOnly>
          <PlusIcon className="size-3" />
        </Button>
      </div>

      {/* Filter bar */}
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

      {/* Data grid */}
      <DataGrid
        columns={columns}
        rows={rows}
        selectedRowIndex={selectedRowIndex}
        onRowClick={onRowClick}
        isLoading={isLoading}
        activeTable={activeTable}
      />

      {/* Footer */}
      <div className="flex items-center gap-4 px-[18px] border-t border-separator bg-surface shrink-0 font-mono text-default-400 h-[38px] text-[11px]">
        {/* Row count + pagination */}
        <span>
          <span className="text-foreground">{rows.length}</span>
          {totalEstimate !== null && <span> / {formatNum(totalEstimate)}</span>} rows
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="size-[20px]" isIconOnly>
            <CaretLeftIcon className="size-2.5" />
          </Button>
          <span>1</span>
          <Button variant="ghost" className="size-[20px]" isIconOnly>
            <CaretRightIcon className="size-2.5" />
          </Button>
        </div>

        <div className="flex-1" />

        {/* View tabs (Data / Structure / Indexes / FK) */}
        <div className="flex p-0.5 rounded-[7px] border border-separator bg-[var(--surface-secondary)]">
          {VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => setActiveView(v)}
              className="px-2.5 py-[3px] rounded-[5px] text-[11px] transition-colors font-sans"
              style={{
                background: activeView === v ? "var(--surface)" : "transparent",
                color: activeView === v ? "var(--foreground)" : "var(--muted)",
                fontWeight: activeView === v ? 500 : 400,
                boxShadow: activeView === v ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
              }}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Status */}
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[oklch(73%_0.18_153)]" />
          ready
        </span>
      </div>
    </div>
  );
}
