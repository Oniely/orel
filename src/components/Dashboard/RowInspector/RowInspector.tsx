import { useMemo } from "react";
import { Button, toast } from "@heroui/react";
import type { ColumnInfo } from "../../../types/database";
import {
  BracketsCurlyIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CopyIcon,
  XIcon,
} from "@phosphor-icons/react";
import { getTypeColor } from "../../../lib/typeColors";
import { buildRowIdentity, identityKey } from "../../../types/write-queue";
import { useHotkeys } from "react-hotkeys-hook";
import { useDashboardStore } from "../../../stores/dashboard.store";
import { useActiveTable } from "../../../hooks/dashboard/useActiveTable";
import { HoldToDeleteButton } from "./HoldToDeleteButton";
import { InspectorEditableField } from "./InspectorEditableField";

export function RowInspector() {
  const selectedRowIndex = useDashboardStore((state) => state.selectedRowIndex);
  const setSelectedRowIndex = useDashboardStore((state) => state.setSelectedRowIndex);
  const setShowInspector = useDashboardStore((state) => state.setShowInspector);
  const { rows, columns, writeQueue: wq } = useActiveTable();
  const rowIndex = selectedRowIndex ?? 0;
  const totalRows = rows.length;
  const row = selectedRowIndex === null ? null : (rows[selectedRowIndex] ?? null);
  const onPrev = () => setSelectedRowIndex(Math.max(0, rowIndex - 1));
  const onNext = () => setSelectedRowIndex(Math.min(totalRows - 1, rowIndex + 1));
  const onClose = () => setShowInspector(false);

  const handleCopy = () => {
    if (row) navigator.clipboard.writeText(JSON.stringify(row, null, 2));
  };

  useHotkeys("esc", () => onClose());
  useHotkeys("up", () => onPrev());
  useHotkeys("left", () => onPrev());
  useHotkeys("right", () => onNext());
  useHotkeys("down", () => onNext());

  const iKey = useMemo(() => {
    if (!row) return null;
    const identity = buildRowIdentity(row, columns);
    return identity ? identityKey(identity) : null;
  }, [row, columns]);
  const rowChange = iKey && wq.scopeKey ? wq.tableChanges?.changes.get(iKey) : undefined;
  const hasRowChanges = !!rowChange;
  const savedColumns = iKey ? wq.recentlySaved?.get(iKey) : undefined;

  const getDirtyValue = (colName: string): { isDirty: boolean; value: unknown } => {
    if (rowChange?.kind === "Update") {
      const cc = rowChange.changes.find((c) => c.column === colName);
      if (cc) return { isDirty: true, value: cc.newValue };
    }
    return { isDirty: false, value: undefined };
  };

  const handleFieldCommit = (col: ColumnInfo, newValue: unknown) => {
    if (!row) return;
    wq.handleCellEdit(rowIndex, col.name, row[col.name], newValue);
  };

  const handleSave = async () => {
    const applied = await wq.handleApplyRow(rowIndex);
    if (applied) toast.success("Row saved");
  };

  const handleDelete = async () => {
    wq.handleDeleteRow(rowIndex);
    const applied = await wq.handleApplyRow(rowIndex);
    if (applied) toast.success("Row deleted");
    onClose();
  };

  return (
    <div className="w-[340px] flex flex-col shrink-0 border-l border-separator bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-4.5 h-13 border-b border-separator">
        <BracketsCurlyIcon size={13} className="text-muted" />
        <span className="text-[13px] font-semibold">Row inspector</span>
        <span className="text-muted text-xs font-mono">
          · {rowIndex + 1}/{totalRows}
        </span>
        <div className="flex-1" />
        <Button variant="ghost" className="size-6.5 grid place-items-center p-[0.5]" isIconOnly onClick={handleCopy}>
          <CopyIcon className="size-3" />
        </Button>
        <Button variant="ghost" className="size-6.5 grid place-items-center p-[0.5]" isIconOnly onClick={onClose}>
          <XIcon className="size-3" />
        </Button>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-1 px-4.5 py-[13px] border-b border-separator">
        <Button
          variant="outline"
          onClick={onPrev}
          isDisabled={rowIndex === 0}
          className="size-6 grid place-items-center"
          isIconOnly
        >
          <CaretLeftIcon className="size-3" />
        </Button>
        <Button
          variant="outline"
          onClick={onNext}
          isDisabled={rowIndex >= totalRows - 1}
          className="size-6 grid place-items-center"
          isIconOnly
        >
          <CaretRightIcon className="size-3" />
        </Button>
        <div className="flex-1" />
        <span className="text-muted text-[11px] font-mono">{columns.length} columns</span>
      </div>

      {/* JSON body */}
      <div className="flex-1 overflow-y-auto px-4.5 py-3.5 scrollbar-hide">
        {row ? (
          <div className="font-mono text-xs leading-[1.8]">
            <span className="text-muted">{"{"}</span>
            {columns.map((col, i) => {
              const { isDirty, value: dirtyValue } = getDirtyValue(col.name);
              const editable = wq.hasPrimaryKey;
              const isSaved = !isDirty && savedColumns?.includes(col.name);

              return (
                <div key={col.name} className="flex gap-2 pl-4 min-w-0">
                  <span style={{ color: getTypeColor(col.dataType), flexShrink: 0, opacity: 0.8 }}>{col.name}:</span>
                  <InspectorEditableField
                    column={col}
                    originalValue={row[col.name]}
                    dirtyValue={dirtyValue}
                    isDirty={isDirty}
                    isSaved={isSaved}
                    editable={editable}
                    onCommit={(newValue) => handleFieldCommit(col, newValue)}
                  />
                  {i < columns.length - 1 && <span className="text-muted shrink-0">,</span>}
                </div>
              );
            })}
            <span className="text-muted">{"}"}</span>
          </div>
        ) : (
          <div className="text-xs text-muted text-center py-8">No row selected</div>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-separator px-4.5 py-2.5 h-14 flex gap-2">
        <Button
          className="flex-1 text-xs font-medium"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
          onClick={handleSave}
          isDisabled={!hasRowChanges || wq.isApplyingRow}
        >
          {wq.isApplyingRow ? "Saving..." : "Save changes"}
        </Button>
        <HoldToDeleteButton onDelete={handleDelete} isDisabled={!wq.hasPrimaryKey} />
      </div>
    </div>
  );
}




