import { useEffect, useMemo, useRef, useState } from "react";
import { useReactTable, getCoreRowModel, flexRender, type CellContext, type ColumnDef } from "@tanstack/react-table";
import { KeyIcon } from "../shared/icons";
import { getTypeColor } from "../../../lib/typeColors";
import { parseEditValue } from "../../../lib/parseValue";
import Cell from "./Cell";
import { useDashboardStore } from "../../../stores/dashboard.store";
import { useDashboardContext } from "../../../hooks/dashboard/useDashboardContext";
import { useActiveTable } from "../../../hooks/dashboard/useActiveTable";
import { CellEditorOverlay } from "./CellEditorOverlay";

const ROW_NUMBER_COL = "__row_number";

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

export function DataGrid() {
  const { activeTableName: activeTable } = useDashboardContext();
  const { columns: colInfos, rows, isLoading, error, writeQueue: wq } = useActiveTable();
  const selectedRowIndex = useDashboardStore((state) => state.selectedRowIndex);
  const setSelectedRowIndex = useDashboardStore((state) => state.setSelectedRowIndex);
  const setShowInspector = useDashboardStore((state) => state.setShowInspector);
  const setContextMenu = useDashboardStore((state) => state.setContextMenu);
  const inspectRow = (index: number) => {
    setSelectedRowIndex(index);
    setShowInspector(true);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
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
      holdingTr.current.style.removeProperty("--hold-indicator-left");
      holdingTr.current.style.removeProperty("--hold-indicator-width");
      holdingTr.current.style.removeProperty("--hold-origin-x");
      holdingTr.current.style.removeProperty("--hold-origin-y");
      holdingTr.current.style.removeProperty("--hold-radius");
      holdingTr.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    cancelLongPress();
    const tr = (e.target as HTMLElement).closest("tr[data-row]") as HTMLElement | null;
    if (!tr || !tr.dataset.row) return;
    const rowIndex = Number(tr.dataset.row);
    const pointerClientX = e.clientX;
    const pointerClientY = e.clientY;
    longPressTriggered.current = false;
    holdingTr.current = tr;
    // Delay visual feedback so quick clicks / double-clicks don't flash the animation
    longPressTimer.current = setTimeout(() => {
      const scrollContainer = scrollRef.current;
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const rowRect = tr.getBoundingClientRect();
        const originX = Math.min(Math.max(pointerClientX - containerRect.left, 0), scrollContainer.clientWidth);
        const originY = Math.min(Math.max(pointerClientY - rowRect.top, 0), rowRect.height);
        const radius = Math.hypot(
          Math.max(originX, scrollContainer.clientWidth - originX),
          Math.max(originY, rowRect.height - originY),
        );

        tr.style.setProperty("--hold-indicator-left", `${scrollContainer.scrollLeft}px`);
        tr.style.setProperty("--hold-indicator-width", `${scrollContainer.clientWidth}px`);
        tr.style.setProperty("--hold-origin-x", `${originX}px`);
        tr.style.setProperty("--hold-origin-y", `${originY}px`);
        tr.style.setProperty("--hold-radius", `${radius}px`);
      }
      tr.setAttribute("data-holding", "");
      longPressTimer.current = setTimeout(() => {
        longPressTriggered.current = true;
        cancelLongPress();
        inspectRow(rowIndex);
      }, 350);
    }, 150);
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
        cell: ({ row }) => <span className="font-mono text-xs text-muted select-none">{row.index + 1}</span>,
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
              className="text-[10px] font-mono px-1 py-[1px] rounded min-w-0 truncate"
              style={{
                color: getTypeColor(c.dataType),
                background: `color-mix(in oklch, ${getTypeColor(c.dataType)} 12%, transparent)`,
              }}
            >
              {c.dataType || "any"}
            </span>
          </div>
        ),
        cell: ({ getValue }: CellContext<Record<string, unknown>, unknown>) => (
          <Cell value={getValue()} type={c.dataType} />
        ),
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
                  className="text-left relative select-none whitespace-nowrap overflow-hidden font-medium text-xs px-3.5 py-2.5 border-b-hairline"
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
            if (tr) setSelectedRowIndex(Number(tr.dataset.row));
          }}
          onContextMenu={(e) => {
            cancelLongPress();
            const tr = (e.target as HTMLElement).closest("tr[data-row]") as HTMLElement | null;
            if (tr) {
              e.preventDefault();
              setContextMenu({ rowIndex: Number(tr.dataset.row), x: e.clientX, y: e.clientY });
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
                    className="insert-row-btn font-mono text-xs select-none"
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
                          <span className="font-mono text-xs text-muted italic select-none opacity-40">DEFAULT</span>
                        ) : !hasValue && c.hasDefault ? (
                          <span
                            className="font-mono text-xs text-muted italic select-none underline decoration-dashed underline-offset-2"
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

          {!isLoading && error && (
            <tr>
              <td colSpan={colInfos.length + 1} className="text-center py-12 px-6 text-sm text-danger">
                {error}
              </td>
            </tr>
          )}

          {!isLoading && !error && rows.length === 0 && wq.insertedRows.length === 0 && (
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
