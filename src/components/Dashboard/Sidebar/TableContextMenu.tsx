import { useEffect, useRef } from "react";
import { ArrowCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react";

interface TableContextMenuProps {
  x: number;
  y: number;
  count: number;
  /** All targeted tables are already staged, so offer to unstage instead */
  isStaged: boolean;
  onStageDelete: () => void;
  onUndoDelete: () => void;
  onClose: () => void;
}

export function TableContextMenu({ x, y, count, isStaged, onStageDelete, onUndoDelete, onClose }: TableContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
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

  const label = count === 1 ? "table" : `${count} tables`;

  return (
    <div
      ref={menuRef}
      style={{ top: y, left: x, position: "fixed", zIndex: 9999 }}
      className="min-w-40 rounded-lg border border-separator bg-surface shadow-xl py-1 overflow-hidden"
    >
      {isStaged ? (
        <button
          onClick={onUndoDelete}
          className="w-full flex items-center gap-2.5 px-3 py-[7px] text-xs text-foreground hover:bg-surface-secondary transition-colors"
        >
          <ArrowCounterClockwiseIcon size={12} weight="bold" className="text-muted shrink-0" />
          Undo delete
        </button>
      ) : (
        <button
          onClick={onStageDelete}
          className="w-full flex items-center gap-2.5 px-3 py-[7px] text-xs text-danger hover:bg-surface-secondary transition-colors"
        >
          <TrashIcon size={12} weight="bold" className="shrink-0" />
          Delete {label}
        </button>
      )}
    </div>
  );
}
