import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RowContextMenu } from "./RowContextMenu";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import type { ColumnInfo, FilterOperator, FilterRow, QueryResult, Tab } from "../../types/database";
import type { WriteQueueActions } from "../../hooks/useWriteQueueActions";
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
import { parseEditValue } from "../../lib/parseValue";
import { SqlEditor, type SqlEditorCommands } from "./SqlEditor";
import Cell from "./Cell";
import { WriteQueueFooter } from "./WriteQueueFooter";

const ROW_NUMBER_COL = "__row_number";

// ── Single floating cell editor (only 1 instance in the DOM) ─────────────────

interface CellEditorOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  cellAttr: string;
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onAdvance: (direction: 1 | -1) => void;
}

function CellEditorOverlay({
  containerRef,
  cellAttr,
  initialValue,
  onCommit,
  onCancel,
  onAdvance,
}: CellEditorOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const [localValue, setLocalValue] = useState(initialValue);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Measure target cell position relative to the scroll container
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const td = container.querySelector(`[data-cell="${cellAttr}"]`) as HTMLElement | null;
    if (!td) return;

    const cRect = container.getBoundingClientRect();
    const tRect = td.getBoundingClientRect();
    setPos({
      top: tRect.top - cRect.top + container.scrollTop,
      left: tRect.left - cRect.left + container.scrollLeft,
      width: tRect.width,
      height: tRect.height,
    });
  }, [containerRef, cellAttr]);

  // Focus + cursor at end
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [pos]);

  if (!pos) return null;

  const doCommit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(localValue);
  };

  return (
    <div
      className="absolute z-[3] flex items-center px-[14px]"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        height: pos.height,
        background: "color-mix(in oklch, var(--warning) 10%, var(--background))",
        boxShadow: "inset 0 0 0 1px var(--warning)",
      }}
    >
      <input
        ref={inputRef}
        className="w-full bg-transparent border-none outline-none font-mono text-xs"
        style={{ color: "var(--foreground)" }}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={doCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            doCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committedRef.current = true;
            onCancel();
          } else if (e.key === "Tab") {
            e.preventDefault();
            doCommit();
            onAdvance(e.shiftKey ? -1 : 1);
          }
        }}
      />
      {/* Dot indicator */}
      <div
        className="absolute bottom-0 right-0 w-2 h-2 rounded-full translate-x-1/2 translate-y-1/2"
        style={{ background: "var(--warning)" }}
      />
    </div>
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

// Static style objects — created once, reused across all renders (avoids per-row/cell allocation)
const deletedRowStyle: React.CSSProperties = { background: "color-mix(in oklch, var(--danger) 8%, transparent)" };
const selectedRowStyle: React.CSSProperties = { background: "color-mix(in oklch, var(--accent) 10%, transparent)" };
const dirtyStyle: React.CSSProperties = {
  background: "color-mix(in oklch, var(--warning) 6%, transparent)",
  boxShadow: "inset 3px 0 0 var(--accent)",
};
const savedStyle: React.CSSProperties = {
  background: "color-mix(in oklch, var(--accent) 12%, transparent)",
};
const insertRowStyle: React.CSSProperties = { background: "color-mix(in oklch, var(--success) 8%, transparent)" };

interface DataGridProps {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  selectedRowIndex: number | null;
  onRowClick: (index: number) => void;
  onRowContextMenu: (index: number, x: number, y: number) => void;
  onInspectRow: (index: number) => void;
  isLoading: boolean;
  activeTable: string | null;
  wq: WriteQueueActions;
}

function DataGrid({
  columns: colInfos,
  rows,
  selectedRowIndex,
  onRowClick,
  onRowContextMenu,
  onInspectRow,
  isLoading,
  activeTable,
  wq,
}: DataGridProps) {
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    column: string;
    isInsert?: boolean;
    initialValue: string;
  } | null>(null);

  // Pre-compute dirty/deleted/saved state once per render — avoids per-cell store lookups
  const { rowKindMap, cellDirtyMap, cellSavedSet } = useMemo(() => {
    const rk = new Map<number, "Update" | "Delete">();
    const cd = new Map<string, { newValue: unknown }>();
    const cs = new Set<string>();
    if (!wq.hasPrimaryKey) return { rowKindMap: rk, cellDirtyMap: cd, cellSavedSet: cs };

    const pkCols = colInfos.filter((c) => c.isPrimary);
    if (pkCols.length === 0) return { rowKindMap: rk, cellDirtyMap: cd, cellSavedSet: cs };

    const hasDirty = wq.tableChanges && wq.scopeKey;
    const hasSaved = wq.recentlySaved && wq.recentlySaved.size > 0;
    if (!hasDirty && !hasSaved) return { rowKindMap: rk, cellDirtyMap: cd, cellSavedSet: cs };

    const changesMap = hasDirty ? wq.tableChanges!.changes : undefined;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = pkCols.map((c) => JSON.stringify(row[c.name] ?? null)).join("::");

      if (changesMap) {
        const change = changesMap.get(key);
        if (change?.kind === "Delete") {
          rk.set(i, "Delete");
        } else if (change?.kind === "Update") {
          rk.set(i, "Update");
          for (const cc of change.changes) cd.set(`${i}::${cc.column}`, cc);
        }
      }

      if (hasSaved) {
        const savedCols = wq.recentlySaved!.get(key);
        if (savedCols) {
          for (const col of savedCols) cs.add(`${i}::${col}`);
        }
      }
    }
    return { rowKindMap: rk, cellDirtyMap: cd, cellSavedSet: cs };
  }, [wq.tableChanges, wq.scopeKey, wq.hasPrimaryKey, wq.recentlySaved, colInfos, rows]);

  const commitEdit = (rawValue: string) => {
    if (!editingCell) return;
    const { rowIndex, column, isInsert } = editingCell;
    const colInfo = colInfos.find((c) => c.name === column);
    if (!colInfo) {
      setEditingCell(null);
      return;
    }

    const parsed = parseEditValue(rawValue, colInfo.dataType, colInfo.isNullable);

    if (isInsert) {
      if (rawValue === "" && colInfo.hasDefault) {
        wq.handleInsertCellEdit(rowIndex, column, undefined);
      } else {
        wq.handleInsertCellEdit(rowIndex, column, parsed);
      }
    } else {
      const originalValue = rows[rowIndex]?.[column];
      if (JSON.stringify(parsed) !== JSON.stringify(originalValue)) {
        wq.handleCellEdit(rowIndex, column, originalValue, parsed);
      }
    }
    setEditingCell(null);
  };

  const startEdit = (rowIndex: number, column: string, isInsert?: boolean) => {
    if (!isInsert && !wq.hasPrimaryKey) return;
    if (column === ROW_NUMBER_COL) return;
    if (!isInsert && rowKindMap.get(rowIndex) === "Delete") return;
    const col = colInfos.find((c) => c.name === column);
    if (isInsert && col?.hasDefault && col.isPrimary) return;

    const currentValue = isInsert
      ? wq.insertedRows[rowIndex]?.kind === "Insert"
        ? wq.insertedRows[rowIndex].values[column]
        : undefined
      : rows[rowIndex]?.[column];

    const dirty = !isInsert ? cellDirtyMap.get(`${rowIndex}::${column}`) : undefined;
    const displayVal = dirty ? dirty.newValue : currentValue;
    const initialValue = displayVal === null || displayVal === undefined ? "" : String(displayVal);

    setEditingCell({ rowIndex, column, isInsert, initialValue });
  };

  const advanceColumn = (direction: 1 | -1) => {
    if (!editingCell) return;
    const colNames = colInfos.map((c) => c.name);
    const currentIdx = colNames.indexOf(editingCell.column);
    let nextIdx = currentIdx + direction;
    // Skip auto-generated PK columns when tabbing through insert rows
    if (editingCell.isInsert) {
      while (nextIdx >= 0 && nextIdx < colNames.length && colInfos[nextIdx].hasDefault && colInfos[nextIdx].isPrimary) {
        nextIdx += direction;
      }
    }
    if (nextIdx >= 0 && nextIdx < colNames.length) {
      startEdit(editingCell.rowIndex, colNames[nextIdx], editingCell.isInsert);
    }
  };

  // Long-press to inspect row (direct DOM mutation to avoid full re-renders)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  const holdingTr = useRef<HTMLElement | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (holdingTr.current) {
      holdingTr.current.removeAttribute("data-holding");
      holdingTr.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    cancelLongPress();
    const tr = (e.target as HTMLElement).closest("tr[data-row]") as HTMLElement | null;
    if (!tr || !tr.dataset.row) return;
    const rowIndex = Number(tr.dataset.row);
    longPressTriggered.current = false;
    holdingTr.current = tr;
    tr.setAttribute("data-holding", "");
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      cancelLongPress();
      onInspectRow(rowIndex);
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  // Column defs — only depends on schema, never on editing/dirty state
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        id: ROW_NUMBER_COL,
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

  const scrollRef = useRef<HTMLDivElement>(null);

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
    <div
      ref={scrollRef}
      onScroll={cancelLongPress}
      className="flex-1 overflow-auto bg-background scrollbar-hide relative"
    >
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

        <tbody
          onPointerDown={handlePointerDown}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onClick={(e) => {
            if (longPressTriggered.current) {
              longPressTriggered.current = false;
              return;
            }
            const tr = (e.target as HTMLElement).closest("tr[data-row]") as HTMLElement | null;
            if (tr) onRowClick(Number(tr.dataset.row));
          }}
          onContextMenu={(e) => {
            cancelLongPress();
            const tr = (e.target as HTMLElement).closest("tr[data-row]") as HTMLElement | null;
            if (tr) {
              e.preventDefault();
              onRowContextMenu(Number(tr.dataset.row), e.clientX, e.clientY);
            }
          }}
          onDoubleClick={(e) => {
            const td = (e.target as HTMLElement).closest("td[data-cell]") as HTMLElement | null;
            if (!td?.dataset.cell) return;
            const [ri, col] = td.dataset.cell.split("::");
            if (td.dataset.cell.startsWith("insert-")) {
              startEdit(Number(ri.replace("insert-", "")), col, true);
            } else {
              startEdit(Number(ri), col);
            }
          }}
        >
          {/* Existing rows */}
          {table.getRowModel().rows.map((row, i) => {
            const rowKind = rowKindMap.get(i);
            const isDeleted = rowKind === "Delete";

            return (
              <tr
                key={row.id}
                data-row={i}
                className={`cursor-pointer h-10${isDeleted ? " line-through opacity-50" : ""}`}
                style={isDeleted ? deletedRowStyle : selectedRowIndex === i ? selectedRowStyle : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const colId = cell.column.id;
                  const dirty = colId !== ROW_NUMBER_COL ? cellDirtyMap.get(`${i}::${colId}`) : undefined;
                  const saved = !dirty && colId !== ROW_NUMBER_COL && cellSavedSet.has(`${i}::${colId}`);

                  return (
                    <td
                      key={cell.id}
                      data-cell={colId !== ROW_NUMBER_COL ? `${i}::${colId}` : undefined}
                      className={`border-b-hairline overflow-hidden whitespace-nowrap px-[14px]${dirty ? "" : " cell-hoverable"}`}
                      style={dirty ? dirtyStyle : saved ? savedStyle : undefined}
                    >
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap">
                        {dirty ? (
                          <Cell
                            value={dirty.newValue}
                            type={colInfos.find((c) => c.name === colId)?.dataType ?? "text"}
                          />
                        ) : (
                          flexRender(cell.column.columnDef.cell, cell.getContext())
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {/* Inserted rows (pending) */}
          {wq.insertedRows.map((insert, insertIdx) => {
            if (insert.kind !== "Insert") return null;
            return (
              <tr key={`insert-${insertIdx}`} className="cursor-pointer h-10" style={insertRowStyle}>
                {/* Row number cell — shows + by default, − on hover to remove */}
                <td className="border-b-hairline px-[14px] overflow-hidden whitespace-nowrap">
                  <button
                    className="insert-row-btn font-mono text-[11px] select-none"
                    onClick={(e) => {
                      e.stopPropagation();
                      wq.handleRemoveInsert(insertIdx);
                    }}
                  >
                    <span className="insert-plus text-success">+</span>
                    <span className="insert-minus text-danger hidden">&minus;</span>
                  </button>
                </td>
                {/* Data cells */}
                {colInfos.map((c) => {
                  const isAutoGenPK = c.hasDefault && c.isPrimary;
                  const hasValue = insert.values[c.name] !== undefined;
                  return (
                    <td
                      key={c.name}
                      data-cell={isAutoGenPK ? undefined : `insert-${insertIdx}::${c.name}`}
                      className={`border-b-hairline overflow-hidden whitespace-nowrap px-[14px]${isAutoGenPK ? "" : " cell-hoverable"}`}
                    >
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap">
                        {isAutoGenPK ? (
                          <span className="font-mono text-[11px] text-muted italic select-none opacity-40">
                            DEFAULT
                          </span>
                        ) : !hasValue && c.hasDefault ? (
                          <span
                            className="font-mono text-[11px] text-muted italic select-none underline decoration-dashed underline-offset-2"
                            style={{ textDecorationColor: "color-mix(in oklch, var(--muted) 50%, transparent)" }}
                          >
                            DEFAULT
                          </span>
                        ) : (
                          <Cell value={insert.values[c.name]} type={c.dataType} />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {rows.length === 0 && wq.insertedRows.length === 0 && (
            <tr>
              <td colSpan={colInfos.length + 1} className="text-center py-12 text-sm text-muted">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Single floating editor — only mounts when actively editing */}
      {editingCell && (
        <CellEditorOverlay
          key={
            editingCell.isInsert
              ? `insert-${editingCell.rowIndex}::${editingCell.column}`
              : `${editingCell.rowIndex}::${editingCell.column}`
          }
          containerRef={scrollRef}
          cellAttr={
            editingCell.isInsert
              ? `insert-${editingCell.rowIndex}::${editingCell.column}`
              : `${editingCell.rowIndex}::${editingCell.column}`
          }
          initialValue={editingCell.initialValue}
          onCommit={commitEdit}
          onCancel={() => setEditingCell(null)}
          onAdvance={advanceColumn}
        />
      )}
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

function StructurePanel({ activeTable }: { activeTable: string | null }) {
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
  wq: WriteQueueActions;
  showInspector: boolean;
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
  wq,
  showInspector,
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
              columns.length > 0
                ? columns
                : [{ name: "column", dataType: "text", isNullable: true, isPrimary: false, hasDefault: false }]
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
            onInspectRow={onInspectRow}
            isLoading={isLoading}
            activeTable={activeTableName}
            wq={wq}
          />
          {contextMenu && (
            <RowContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onInspect={() => {
                onInspectRow(contextMenu.rowIndex);
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
        <StructurePanel activeTable={activeTableName} />
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

      {/* Footer */}
      {!isQueryTab && activeTableName && (
        <div className="flex items-center justify-between gap-4 px-4.5 border-t border-separator bg-surface shrink-0 font-mono text-muted py-3.5 text-[11px]">
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
