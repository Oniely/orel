import { Button, Dropdown, Label, ToggleButton } from "@heroui/react";
import type { ActiveConnection } from "../../types/connection";
import {
  ArrowClockwiseIcon,
  ArrowLineUpIcon,
  CaretDownIcon,
  DatabaseIcon,
  PlusIcon,
  SidebarIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { INNER_W, SIDEBAR_PAD, SIDEBAR_WIDTH } from "./constants";

interface HeaderProps {
  connection: ActiveConnection;
  activeDatabase: string | null;
  showInspector: boolean;
  onToggleInspector: () => void;
  onRefresh: () => void;
  onDatabaseSelect: (database: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function Header({
  connection,
  activeDatabase,
  showInspector,
  onToggleInspector,
  onRefresh,
  onDatabaseSelect,
  sidebarOpen,
  onToggleSidebar,
}: HeaderProps) {
  const latency = null; // TODO: track latency after connect

  return (
    <div className="h-[52px] flex items-center shrink-0 border-b border-separator bg-surface">
      {/* Left zone — matches sidebar width */}
      <div
        className="flex items-center border-r border-separator h-full shrink-0"
        style={{
          width: sidebarOpen ? SIDEBAR_WIDTH : "auto",
          padding: `0 ${SIDEBAR_PAD}px`,
          display: sidebarOpen ? "flex" : "none",
        }}
      >
        <Button size="sm" variant="tertiary" style={{ width: INNER_W }} className="flex items-center gap-2.5 px-3.5">
          {/* Connection status dot with glow */}
          <span className="relative w-2 h-2 shrink-0">
            <span className="absolute inset-0 rounded-full" style={{ background: "oklch(73% 0.18 153)" }} />
            <span
              className="absolute rounded-full"
              style={{
                inset: -3,
                borderRadius: 999,
                background: "oklch(73% 0.18 153)",
                opacity: 0.25,
              }}
            />
          </span>
          <span className="font-medium text-[12.5px] truncate flex-1 text-left">{connection.config.name}</span>
          {latency !== null && <span className="font-mono text-[10.5px] text-default-400 shrink-0">{latency}ms</span>}
          <CaretDownIcon size={12} />
        </Button>
      </div>

      {/* Right zone — content header */}
      <div className="flex-1 flex items-center gap-2.5 px-4 min-w-0">
        {/* Sidebar Toggle */}
        <ToggleButton size="sm" isSelected={sidebarOpen} onChange={onToggleSidebar} className="grid place-items-center">
          <SidebarIcon className="size-4" />
        </ToggleButton>

        {/* Database switcher */}
        <Dropdown>
          <Button size="sm" variant="tertiary" className="flex items-center justify-between gap-3 w-[225px]">
            <div className="inline-flex items-center gap-3">
              <DatabaseIcon />
              <span className="font-mono text-xs">{activeDatabase ?? connection.config.defaultDatabase ?? "—"}</span>
            </div>
            <CaretDownIcon />
          </Button>
          <Dropdown.Popover className="w-[225px] p-1">
            <Dropdown.Menu onAction={(key) => onDatabaseSelect(String(key))}>
              {connection.databases.length === 0 ? (
                <Dropdown.Item id="no-databases" textValue="No databases" isDisabled>
                  <Label>No databases</Label>
                </Dropdown.Item>
              ) : (
                connection.databases.map((db) => (
                  <Dropdown.Item key={db} id={db} textValue={db}>
                    <Label>{db}</Label>
                  </Dropdown.Item>
                ))
              )}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>

        {/* Separator */}
        <div className="flex-1" />

        {/* Action buttons */}
        <Button size="sm" variant="outline" className="flex items-center gap-1.5 text-xs">
          <ArrowLineUpIcon className="size-3" weight="bold" />
          Export
        </Button>

        <Button size="sm" variant="outline" className="flex items-center gap-1.5 text-xs">
          <PlusIcon className="size-3" weight="bold" />
          Add row
        </Button>

        <Button onClick={onRefresh} size="sm" variant="outline" className="grid place-items-center">
          <ArrowClockwiseIcon className="size-4" />
        </Button>

        <ToggleButton
          size="sm"
          isSelected={showInspector}
          onChange={onToggleInspector}
          className="grid place-items-center transition-colors border"
          style={{ background: showInspector ? "var(--surface-secondary)" : "transparent" }}
        >
          <SidebarSimpleIcon className="size-4 rotate-y-180" />
        </ToggleButton>
      </div>
    </div>
  );
}
