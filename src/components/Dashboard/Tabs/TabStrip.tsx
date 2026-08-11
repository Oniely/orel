import { useLayoutEffect, useRef } from "react";
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

  return (
    <div
      ref={stripRef}
      className="h-13 flex items-center gap-1 px-3 border-b border-separator bg-surface shrink-0 min-w-0 overflow-x-auto scrollbar-hide"
    >
      {openTabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        return (
          <div
            key={tab.id}
            data-active-tab={isActive}
            onClick={() => commands.activateTab(tab.id)}
            className="flex items-center gap-2 px-3 h-7 rounded-lg cursor-pointer text-xs font-mono transition-colors shrink-0"
            style={{
              background: isActive ? "var(--surface-secondary)" : "transparent",
              border: isActive
                ? "1px solid color-mix(in oklch, var(--separator) 60%, transparent)"
                : "1px solid transparent",
              color: isActive ? "var(--foreground)" : "var(--muted)",
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
