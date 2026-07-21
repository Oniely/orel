import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button, Tooltip, toast } from "@heroui/react";
import type { ColumnInfo } from "../../types/database";
import type { WriteQueueActions } from "../../hooks/useWriteQueueActions";
import { BracketsCurlyIcon, CaretLeftIcon, CaretRightIcon, CopyIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { getTypeColor } from "../../lib/typeColors";
import { parseEditValue } from "../../lib/parseValue";
import { buildRowIdentity, identityKey } from "../../types/write-queue";
import { useHotkeys } from "react-hotkeys-hook";

// ── Editable Field ───────────────────────────────────────────────────────────

interface EditableFieldProps {
  column: ColumnInfo;
  originalValue: unknown;
  dirtyValue: unknown | undefined;
  isDirty: boolean;
  editable: boolean;
  onCommit: (newValue: unknown) => void;
}

function EditableField({ column, originalValue, dirtyValue, isDirty, editable, onCommit }: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  const displayValue = isDirty ? dirtyValue : originalValue;
  const color = getTypeColor(column.dataType);

  useEffect(() => {
    if (isEditing) {
      committedRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    if (!editable) return;
    const val = displayValue === null || displayValue === undefined ? "" : String(displayValue);
    setInputValue(val);
    setIsEditing(true);
  };

  const doCommit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const parsed = parseEditValue(inputValue, column.dataType, column.isNullable);
    onCommit(parsed);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="w-full bg-transparent border-none outline-none font-mono text-xs text-foreground"
        style={{
          background: "color-mix(in oklch, var(--warning) 10%, transparent)",
          borderRadius: 3,
          padding: "2px 4px",
          margin: "-2px -4px",
        }}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={doCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            doCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committedRef.current = true;
            setIsEditing(false);
          }
        }}
      />
    );
  }

  const formattedValue =
    displayValue === null || displayValue === undefined ? (
      <span className="text-muted italic">null</span>
    ) : (
      <span style={{ color }}>{JSON.stringify(displayValue)}</span>
    );

  return (
    <span
      className={`truncate${editable ? " cursor-pointer" : ""}`}
      onDoubleClick={handleDoubleClick}
      style={
        isDirty
          ? {
              background: "color-mix(in oklch, var(--warning) 8%, transparent)",
              borderRadius: 3,
              padding: "1px 4px",
              margin: "-1px -4px",
            }
          : undefined
      }
    >
      {formattedValue}
    </span>
  );
}

// ── Hold-to-Delete Button (3×3 Tiles Animation) ─────────────────────────────

const HOLD_DURATION = 800; // ms
const CANCEL_DURATION = 300; // ms
// Center first, corners, then edges — spiral-like fill pattern
const TILE_ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5];

type Phase = "idle" | "holding" | "canceling" | "deleting";

interface HoldToDeleteButtonProps {
  onDelete: () => Promise<void>;
  isDisabled: boolean;
}

function HoldToDeleteButton({ onDelete, isDisabled }: HoldToDeleteButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const cancelStartRef = useRef(0);
  const cancelFromRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");

  // Keep phaseRef in sync so RAF callbacks read the latest value
  phaseRef.current = phase;

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const holdTick = useCallback(() => {
    if (phaseRef.current !== "holding") return;
    const p = Math.min(1, (performance.now() - startRef.current) / HOLD_DURATION);
    setProgress(p);
    if (p < 1) rafRef.current = requestAnimationFrame(holdTick);
  }, []);

  const cancelTick = useCallback(() => {
    if (phaseRef.current !== "canceling") return;
    const t = (performance.now() - cancelStartRef.current) / CANCEL_DURATION;
    const p = Math.max(0, cancelFromRef.current * (1 - t));
    if (p <= 0) {
      setPhase("idle");
      setProgress(0);
      return;
    }
    setProgress(p);
    rafRef.current = requestAnimationFrame(cancelTick);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (isDisabled || phase === "deleting") return;
    e.preventDefault();
    cancelAnimationFrame(rafRef.current);
    startRef.current = performance.now() - progress * HOLD_DURATION;
    setPhase("holding");
    phaseRef.current = "holding";
    rafRef.current = requestAnimationFrame(holdTick);
  };

  const cancelHold = () => {
    if (phaseRef.current !== "holding") return;
    cancelAnimationFrame(rafRef.current);
    cancelStartRef.current = performance.now();
    cancelFromRef.current = progress;
    setPhase("canceling");
    phaseRef.current = "canceling";
    rafRef.current = requestAnimationFrame(cancelTick);
  };

  const onUp = async () => {
    if (phaseRef.current !== "holding") return;
    cancelAnimationFrame(rafRef.current);
    if (progress >= 1) {
      // Complete — trigger delete
      setPhase("deleting");
      phaseRef.current = "deleting";
      try {
        await onDelete();
      } catch {
        setPhase("idle");
        setProgress(0);
      }
    } else {
      cancelHold();
    }
  };

  const prevent = (e: React.SyntheticEvent) => e.preventDefault();

  const disabled = isDisabled || phase === "deleting";
  const holding = phase === "holding";
  const p = phase === "deleting" ? 1 : progress;

  // Per-tile scale: staggered cascade — each tile starts filling at a different time
  const tileScales = TILE_ORDER.map((ord) => Math.max(0, Math.min(1, (p - ord * 0.09) / 0.22)));

  const tooltipContent = holding ? (
    progress >= 1 ? (
      <span>
        Release to delete
        <br />
        <span className="text-muted" style={{ fontSize: 10 }}>
          Hover outside to cancel
        </span>
      </span>
    ) : (
      "Keep holding..."
    )
  ) : phase === "deleting" ? (
    "Deleting..."
  ) : (
    "Hold to delete"
  );

  const tooltipOpen = holding ? true : phase === "canceling" || phase === "deleting" ? false : undefined;

  return (
    <Tooltip delay={phase === "idle" ? 500 : 0} isOpen={tooltipOpen}>
      <Tooltip.Trigger>
        <button
          className="relative overflow-hidden grid place-items-center select-none"
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: `1.5px solid ${p > 0 ? "var(--danger)" : "var(--separator)"}`,
            background: "var(--surface)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            padding: 0,
            touchAction: "none",
            transform: phase === "deleting" ? "scale(.94)" : holding ? "scale(1.06)" : "scale(1)",
            transition: "transform .34s cubic-bezier(.34,1.56,.64,1)",
            isolation: "isolate",
          }}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={cancelHold}
          onContextMenu={prevent}
          disabled={disabled}
        >
          {/* 3×3 tile grid overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gridTemplateRows: "repeat(3, 1fr)",
            }}
          >
            {tileScales.map((scale, i) => (
              <div
                key={i}
                style={{
                  background: "var(--danger)",
                  transform: `scale(${scale.toFixed(3)})`,
                  transformOrigin: "center",
                  transition: "transform .12s ease",
                }}
              />
            ))}
          </div>
          <TrashIcon
            className="size-3.5 relative"
            style={{
              zIndex: 3,
              color: p > 0.6 ? "var(--danger-foreground, #fff)" : "var(--danger)",
              transition: "color .2s ease",
            }}
          />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>{tooltipContent}</Tooltip.Content>
    </Tooltip>
  );
}

// ── Row Inspector ────────────────────────────────────────────────────────────

interface RowInspectorProps {
  row: Record<string, unknown> | null;
  columns: ColumnInfo[];
  rowIndex: number;
  totalRows: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  wq: WriteQueueActions;
}

export function RowInspector({ row, columns, rowIndex, totalRows, onPrev, onNext, onClose, wq }: RowInspectorProps) {
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
      <div className="flex items-center gap-2 px-4.5 py-3.5 border-b border-separator">
        <BracketsCurlyIcon size={13} className="text-muted" />
        <span className="text-[13px] font-semibold">Row inspector</span>
        <span className="text-muted text-[11px] font-mono">
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
        <span className="text-muted text-[10px] font-mono">{columns.length} columns</span>
      </div>

      {/* JSON body */}
      <div className="flex-1 overflow-y-auto px-4.5 py-3.5 scrollbar-hide">
        {row ? (
          <div className="font-mono text-xs leading-[1.8]">
            <span className="text-muted">{"{"}</span>
            {columns.map((col, i) => {
              const { isDirty, value: dirtyValue } = getDirtyValue(col.name);
              const editable = wq.hasPrimaryKey;

              return (
                <div key={col.name} className="flex gap-2 pl-4 min-w-0">
                  <span style={{ color: getTypeColor(col.dataType), flexShrink: 0, opacity: 0.8 }}>{col.name}:</span>
                  <EditableField
                    column={col}
                    originalValue={row[col.name]}
                    dirtyValue={dirtyValue}
                    isDirty={isDirty}
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
      <div className="border-t border-separator px-4.5 py-2.5 flex gap-2">
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
