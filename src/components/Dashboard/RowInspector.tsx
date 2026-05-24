import { Button } from "@heroui/react";
import type { ColumnInfo } from "../../types/database";
import { BracketsCurlyIcon, CaretLeftIcon, CaretRightIcon, CopyIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { getTypeColor } from "../../lib/typeColors";
import { useHotkeys } from "react-hotkeys-hook";

function JsonValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) return <span className="text-default-400 italic text-muted">null</span>;
  const color = getTypeColor(type);

  return (
    <span className="text-foreground" style={{ color }}>
      {JSON.stringify(value)}
    </span>
  );
}

interface RowInspectorProps {
  row: Record<string, unknown> | null;
  columns: ColumnInfo[];
  rowIndex: number;
  totalRows: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function RowInspector({ row, columns, rowIndex, totalRows, onPrev, onNext, onClose }: RowInspectorProps) {
  const handleCopy = () => {
    if (row) navigator.clipboard.writeText(JSON.stringify(row, null, 2));
  };

  useHotkeys("esc", () => onClose());

  return (
    <div className="w-[340px] flex flex-col shrink-0 border-l border-separator bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-4.5 py-3.5 border-b border-separator">
        <BracketsCurlyIcon size={13} className="text-default-400" />
        <span className="text-[13px] font-semibold">Row inspector</span>
        <span className="text-default-400 text-[11px] font-mono">
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
      <div className="flex items-center gap-1 px-4.5 py-2 border-b border-separator">
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
        <span className="text-default-400 text-[10px] font-mono">{columns.length} columns</span>
      </div>

      {/* JSON body */}
      <div className="flex-1 overflow-y-auto px-4.5 py-3.5 scrollbar-hide">
        {row ? (
          <div className="font-mono text-xs leading-[1.8]">
            <span className="text-default-400">{"{"}</span>
            {columns.map((col, i) => (
              <div key={col.name} className="flex gap-2 pl-4 min-w-0">
                <span style={{ color: getTypeColor(col.dataType), flexShrink: 0, opacity: 0.8 }}>{col.name}:</span>
                <span className="truncate">
                  <JsonValue value={row[col.name]} type={col.dataType} />
                </span>
                {i < columns.length - 1 && <span className="text-default-400 shrink-0">,</span>}
              </div>
            ))}
            <span className="text-default-400">{"}"}</span>
          </div>
        ) : (
          <div className="text-xs text-default-400 text-center py-8">No row selected</div>
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t border-separator px-4.5 py-2.5 flex gap-2">
        <Button
          className="flex-1 text-xs font-medium"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          Save changes
        </Button>
        <Button variant="danger-soft" className="grid place-items-center p-1" isIconOnly>
          <TrashIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
