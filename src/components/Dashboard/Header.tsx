import { Button, Dropdown, Label, Separator, Spinner, toast, ToggleButton } from "@heroui/react";
import type { ActiveConnection, SavedConnection } from "../../types/connection";
import {
  ArrowClockwiseIcon,
  ArrowLineUpIcon,
  CaretDownIcon,
  DatabaseIcon,
  PlusIcon,
  SignOutIcon,
  SidebarIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { INNER_W, SIDEBAR_PAD, SIDEBAR_WIDTH } from "./constants";
import { useNavigate } from "@tanstack/react-router";
import { useConnectionStore } from "../../stores/connection.store";
import { useConnect } from "../../hooks/useConnections";

interface HeaderProps {
  connection: ActiveConnection;
  activeDatabase: string | null;
  showInspector: boolean;
  onToggleInspector: () => void;
  onRefresh: () => void;
  onDatabaseSelect: (database: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onDisconnect: () => void;
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
  onDisconnect,
}: HeaderProps) {
  const latency = null; // TODO: track latency after connect
  const navigate = useNavigate();
  const { savedConnections, activeConnections, setFocusedConnection, closeConnection } = useConnectionStore();
  const connect = useConnect();
  const isConnecting = Object.values(activeConnections).some((c) => c.status === "connecting");

  const handleConnect = (conn: SavedConnection) => {
    const existing = activeConnections[conn.id];
    if (existing && existing.status === "connected") {
      setFocusedConnection(conn.id);
      return;
    }
    connect.mutate(conn, {
      onSuccess: () => {
        toast.success("Connected successfully!");
      },
      onError: () => {
        closeConnection(conn.id);
        toast.danger(`Failed to connect: ${conn.name}`);
      },
    });
  };

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
        {/* Connection switcher */}
        <Dropdown>
          <Button size="sm" variant="tertiary" style={{ width: INNER_W }} className="flex items-center gap-2.5 px-3.5">
            {/* Connection status dot with glow / loading spinner */}
            {isConnecting ? (
              <Spinner size="sm" />
            ) : (
              <span className="relative w-2 h-2 shrink-0 animate-pulse">
                <span className="absolute inset-0 rounded-full" style={{ background: "var(--accent)" }} />
                <span
                  className="absolute rounded-full"
                  style={{
                    inset: -3,
                    borderRadius: 999,
                    background: "var(--accent)",
                    opacity: 0.25,
                  }}
                />
              </span>
            )}
            <span className="font-medium text-[12.5px] truncate flex-1 text-left">{connection.config.name}</span>
            {latency !== null && <span className="font-mono text-[10.5px] text-muted shrink-0">{latency}ms</span>}
            <CaretDownIcon size={12} />
          </Button>
          <Dropdown.Popover className="w-[200px] p-1">
            <Dropdown.Menu
              onAction={(key) => {
                if (key === "disconnect") onDisconnect();
                if (key === "new-connection") navigate({ to: "/" });
              }}
            >
              {savedConnections.length > 0 &&
                savedConnections.map((saved_connection) => {
                  if (saved_connection.id !== connection.config.id)
                    return (
                      <Dropdown.Item key={saved_connection.id} onClick={() => handleConnect(saved_connection)}>
                        <DatabaseIcon className="size-4" />
                        <Label>{saved_connection.name}</Label>
                      </Dropdown.Item>
                    );
                })}
              <Separator className="my-1" />
              <Dropdown.Item id="new-connection" textValue="New Connection">
                <PlusIcon className="size-4" />
                <Label>New Connection</Label>
              </Dropdown.Item>
              <Dropdown.Item id="disconnect" textValue="Disconnect" variant="danger">
                <SignOutIcon className="size-4 text-danger" />
                <Label>Disconnect</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
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
