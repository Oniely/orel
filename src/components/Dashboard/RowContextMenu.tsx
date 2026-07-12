import { useEffect, useRef } from "react";
import { ArrowCounterClockwiseIcon, MagnifyingGlassIcon, TrashIcon } from "@phosphor-icons/react";

interface RowContextMenuProps {
  x: number;
  y: number;
  onInspect: () => void;
  onClose: () => void;
  onDeleteRow?: () => void;
  isRowDeleted?: boolean;
  onUndoDelete?: () => void;
}

export function RowContextMenu({ x, y, onInspect, onClose, onDeleteRow, isRowDeleted, onUndoDelete }: RowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ top: y, left: x, position: "fixed", zIndex: 9999 }}
      className="min-w-40 rounded-lg border border-separator bg-surface shadow-xl py-1 overflow-hidden"
    >
      <button
        onClick={onInspect}
        className="w-full flex items-center gap-2.5 px-3 py-[7px] text-xs text-foreground hover:bg-surface-secondary transition-colors"
      >
        <MagnifyingGlassIcon size={12} className="text-muted shrink-0" />
        Inspect
      </button>

      <div className="h-px bg-separator mx-2 my-1" />

      {isRowDeleted && onUndoDelete ? (
        <button
          onClick={onUndoDelete}
          className="w-full flex items-center gap-2.5 px-3 py-[7px] text-xs text-foreground hover:bg-surface-secondary transition-colors"
        >
          <ArrowCounterClockwiseIcon size={12} className="text-muted shrink-0" />
          Undo delete
        </button>
      ) : onDeleteRow ? (
        <button
          onClick={onDeleteRow}
          className="w-full flex items-center gap-2.5 px-3 py-[7px] text-xs text-danger hover:bg-surface-secondary transition-colors"
        >
          <TrashIcon size={12} className="shrink-0" />
          Delete row
        </button>
      ) : (
        <div className="px-3 py-[7px] text-xs text-muted italic">
          No primary key
        </div>
      )}
    </div>
  );
}
