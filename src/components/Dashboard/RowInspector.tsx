import { Button } from "@heroui/react";
import type { ColumnInfo } from "../../types/database";
import { BracketsCurlyIcon, CaretLeftIcon, CaretRightIcon, CopyIcon, TrashIcon, XIcon } from "@phosphor-icons/react";

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

function JsonValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-default-400 italic">null</span>;
  if (typeof value === "boolean") return <span style={{ color: "oklch(74% 0.13 30)" }}>{String(value)}</span>;
  if (typeof value === "number") return <span style={{ color: "oklch(78% 0.12 100)" }}>{value}</span>;
  if (typeof value === "string") return <span style={{ color: "oklch(74% 0.12 220)" }}>"{value}"</span>;
  return <span className="text-foreground">{JSON.stringify(value)}</span>;
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
                <span style={{ color: getTypeColor(col.dataType), flexShrink: 0 }}>{col.name}:</span>
                <span className="truncate">
                  <JsonValue value={row[col.name]} />
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
