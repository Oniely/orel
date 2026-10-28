import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { BracketsCurlyIcon, PicnicTableIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useDashboardStore } from "../../../stores/dashboard.store";
import { useDashboardCommands } from "../../../hooks/dashboard/useDashboardCommands";
import { useDashboardContext } from "../../../hooks/dashboard/useDashboardContext";

export function TabStrip() {
  const { openTabs, activeTabId } = useDashboardContext();
  const showInspector = useDashboardStore((state) => state.showInspector);
  const commands = useDashboardCommands();
  const stripRef = useRef<HTMLDivElement>(null);
  // Tab being dragged; it swaps places with whichever tab the pointer enters until release.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Horizontal offset (px) the dragged tab is currently displaced from its resting slot.
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const dragStartXRef = useRef(0);
  // Positions of each tab from the previous render, used to FLIP-animate reorders.
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useEffect(() => {
    if (!draggingId) return;

    const handlePointerMove = (event: PointerEvent) => {
      setDragOffsetX(event.clientX - dragStartXRef.current);
    };
    const stopDragging = () => {
      setDraggingId(null);
      setDragOffsetX(0);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopDragging);
      document.removeEventListener("pointercancel", stopDragging);
    };
  }, [draggingId]);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>("[data-active-tab='true']");
    if (!strip || !tab) return;

    const padding = 12;
    const stripBounds = strip.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    const leftDelta = tabBounds.left - stripBounds.left;
    const rightDelta = tabBounds.right - stripBounds.right;

    if (leftDelta < padding) {
      strip.scrollTo({
        left: Math.max(0, strip.scrollLeft + leftDelta - padding),
        behavior: "smooth",
      });
    } else if (rightDelta > -padding) {
      strip.scrollTo({
        left: strip.scrollLeft + rightDelta + padding,
        behavior: "smooth",
      });
    }
  }, [activeTabId, showInspector]);

  // FLIP animation: when tabs reorder, slide each one from its old slot into its new
  // one instead of popping, like a browser tab strip.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const elements = Array.from(strip.querySelectorAll<HTMLElement>("[data-tab-id]"));
    const nextRects = new Map<string, DOMRect>();

    elements.forEach((el) => {
      const id = el.dataset.tabId!;
      nextRects.set(id, el.getBoundingClientRect());
    });

    elements.forEach((el) => {
      const id = el.dataset.tabId!;
      if (id === draggingId) return;
      const prev = prevRectsRef.current.get(id);
      const next = nextRects.get(id);
      if (!prev || !next) return;
      const dx = prev.left - next.left;
      if (!dx) return;
      el.style.transition = "none";
      el.style.transform = `translateX(${dx}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 150ms ease";
        el.style.transform = "";
      });
    });

    prevRectsRef.current = nextRects;
  }, [openTabs, draggingId]);

  return (
    <div
      ref={stripRef}
      className="h-13 flex items-center gap-1 px-3 border-b border-separator bg-surface shrink-0 min-w-0 overflow-x-auto scrollbar-hide"
    >
      {openTabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        const isDragging = draggingId === tab.id;
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            data-active-tab={isActive}
            onClick={() => commands.activateTab(tab.id)}
            onPointerDown={(event) => {
              if (event.button === 0) {
                dragStartXRef.current = event.clientX;
                setDraggingId(tab.id);
                setDragOffsetX(0);
              }
            }}
            onPointerEnter={() => {
              if (draggingId && draggingId !== tab.id) commands.moveTab(draggingId, tab.id);
            }}
            className="flex items-center gap-2 px-3 h-7 rounded-lg select-none text-xs font-mono shrink-0"
            style={{
              background: isActive ? "var(--surface-secondary)" : "transparent",
              border: isActive
                ? "1px solid color-mix(in oklch, var(--separator) 60%, transparent)"
                : "1px solid transparent",
              color: isActive ? "var(--foreground)" : "var(--muted)",
              cursor: isDragging ? "grabbing" : "grab",
              transform: isDragging ? `translateX(${dragOffsetX}px) scale(1.03)` : undefined,
              transition: isDragging ? "none" : "background-color 150ms ease, border-color 150ms ease",
              zIndex: isDragging ? 10 : undefined,
              position: isDragging ? "relative" : undefined,
              boxShadow: isDragging ? "0 6px 16px color-mix(in oklch, black 35%, transparent)" : undefined,
              opacity: isDragging ? 0.95 : undefined,
              // Let pointer events pass through to the tab underneath so swap detection
              // (onPointerEnter) keeps working while this one is visually displaced.
              pointerEvents: isDragging ? "none" : undefined,
            }}
          >
            {tab.type === "query" ? (
              <BracketsCurlyIcon
                size={16}
                className="opacity-60 shrink-0"
                style={{
                  color: isActive ? "var(--accent)" : undefined,
                  opacity: isActive ? 1 : 0.6,
                }}
              />
            ) : (
              <PicnicTableIcon
                size={16}
                className="opacity-60 shrink-0"
                style={{
                  color: isActive ? "var(--accent)" : undefined,
                  opacity: isActive ? 1 : 0.6,
                }}
              />
            )}
            <span>{tab.label}</span>
            <button
              onClick={(event) => {
                event.stopPropagation();
                commands.closeTab(tab.id);
              }}
              className="w-4 h-4 grid place-items-center rounded-[3px] opacity-50 hover:opacity-100 transition-opacity"
            >
              <XIcon size={10} />
            </button>
          </div>
        );
      })}
      <Button size="sm" variant="ghost" onClick={commands.openQuery} className="ml-0.5 shrink-0" isIconOnly>
        <PlusIcon className="size-3" />
      </Button>
    </div>
  );
}
