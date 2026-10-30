import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import { useReorderConnections } from "../../hooks/useConnections";
import { useConnectionStore } from "../../stores/connection.store";
import type { SavedConnection } from "../../types/connection";
import { computeDragReorderTarget } from "../Dashboard/Tabs/tabDragReorder";
import ConnectionRow from "./ConnectionRow";

interface DragState {
  id: string;
  anchorY: number;
  top: number;
  startOrder: string[];
}

function moveConnection(list: SavedConnection[], id: string, targetId: string) {
  const from = list.findIndex((c) => c.id === id);
  const to = list.findIndex((c) => c.id === targetId);
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, list[from]);
  return next;
}

export function ConnectionList({
  onEdit,
  onDelete,
}: {
  onEdit: (connection: SavedConnection) => void;
  onDelete: (connection: SavedConnection) => void;
}) {
  const connections = useConnectionStore((s) => s.savedConnections);
  const setSavedConnections = useConnectionStore((s) => s.setSavedConnections);
  const reorder = useReorderConnections();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;
  const reorderRef = useRef(reorder);
  reorderRef.current = reorder;

  useEffect(() => {
    if (!draggingId) return;

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const list = listRef.current;
      if (!drag || !list) return;

      const offset = event.clientY - drag.anchorY;
      // Rows are laid out vertically, so feed top/height into the shared 1-D slot math.
      const slots = Array.from(list.querySelectorAll<HTMLElement>("[data-connection-id]")).map((el) => ({
        id: el.dataset.connectionId!,
        left: el.offsetTop,
        width: el.offsetHeight,
      }));
      const draggedSlot = slots.find((slot) => slot.id === drag.id);
      if (!draggedSlot) return;

      const targetId = computeDragReorderTarget(slots, drag.id, draggedSlot.left + draggedSlot.width / 2 + offset);
      if (targetId) setSavedConnections(moveConnection(connectionsRef.current, drag.id, targetId));
      setDragOffsetY(offset);
    };

    const stopDragging = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      setDragOffsetY(0);
      document.body.style.userSelect = "";
      if (!drag) return;
      const ids = connectionsRef.current.map((c) => c.id);
      if (ids.join() !== drag.startOrder.join()) reorderRef.current.mutate(ids);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
    window.addEventListener("blur", stopDragging);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopDragging);
      document.removeEventListener("pointercancel", stopDragging);
      window.removeEventListener("blur", stopDragging);
    };
  }, [draggingId, setSavedConnections]);

  // After a reorder lands, shift the anchor by the row's real move so it stays under the cursor.
  useLayoutEffect(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-connection-id="${drag.id}"]`);
    if (!el) return;
    const dy = el.offsetTop - drag.top;
    if (dy === 0) return;
    drag.top = el.offsetTop;
    drag.anchorY += dy;
    setDragOffsetY((current) => current - dy);
  }, [connections]);

  return (
    <div ref={listRef} className="flex flex-col gap-2">
      {connections.map((conn) => {
        const isDragging = draggingId === conn.id;
        return (
          <div
            key={conn.id}
            data-connection-id={conn.id}
            className="group/drag relative"
            style={{
              transform: isDragging ? `translateY(${dragOffsetY}px)` : undefined,
              zIndex: isDragging ? 10 : undefined,
              opacity: isDragging ? 0.95 : undefined,
            }}
          >
            <button
              type="button"
              aria-label={`Reorder ${conn.name}`}
              draggable={false}
              className={`absolute -left-6 top-1/2 -translate-y-1/2 p-0.5 text-muted touch-none transition-opacity ${
                isDragging ? "opacity-100 cursor-grabbing" : "opacity-0 group-hover/drag:opacity-100 cursor-grab"
              }`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                document.body.style.userSelect = "none";
                dragRef.current = {
                  id: conn.id,
                  anchorY: event.clientY,
                  top: event.currentTarget.parentElement!.offsetTop,
                  startOrder: connections.map((c) => c.id),
                };
                setDraggingId(conn.id);
                setDragOffsetY(0);
              }}
            >
              <DotsSixVerticalIcon size={16} />
            </button>
            <ConnectionRow connection={conn} onEdit={onEdit} onDelete={onDelete} />
          </div>
        );
      })}
    </div>
  );
}
