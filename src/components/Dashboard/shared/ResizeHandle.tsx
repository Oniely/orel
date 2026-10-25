import type { PointerEvent } from "react";

interface ResizeHandleProps {
  /** Which edge of the panel the handle sits on. */
  side: "left" | "right";
  width: number;
  onResize: (width: number) => void;
}

/** Drag handle on a side panel's edge; reports the new panel width while dragging. */
export function ResizeHandle({ side, width, onResize }: ResizeHandleProps) {
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const direction = side === "right" ? 1 : -1;

    const onMove = (e: globalThis.PointerEvent) => onResize(width + (e.clientX - startX) * direction);
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      className={`absolute top-0 bottom-0 w-1.5 z-10 cursor-col-resize transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_40%,transparent)] ${
        side === "right" ? "-right-[3px]" : "-left-[3px]"
      }`}
    />
  );
}
