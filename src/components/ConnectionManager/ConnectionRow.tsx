import { useNavigate } from "@tanstack/react-router";
import { useDeleteConnection, useConnect } from "../../hooks/useConnections";
import { useConnectionStore } from "../../stores/connection.store";
import { SavedConnection } from "../../types/connection";
import { DB_LABELS } from "../../routes";
import { Button, Spinner, toast } from "@heroui/react";

import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { PencilLineIcon, TrashIcon } from "@phosphor-icons/react";
const appWindow = getCurrentWindow();

export default function ConnectionRow({
  connection,
  onEdit,
}: {
  connection: SavedConnection;
  onEdit: (connection: SavedConnection) => void;
}) {
  const navigate = useNavigate();
  const deleteConnection = useDeleteConnection();
  const connect = useConnect();
  const isConnecting = connect.isPending;
  // check for any connection that are connecting (global check)
  const isAnyConnecting = useConnectionStore((s) =>
    Object.values(s.activeConnections).some((c) => c.status === "connecting"),
  );
  const isDisabled = isAnyConnecting && !isConnecting; // disable row except the one that's connecting

  const handleConnect = () => {
    if (isAnyConnecting) return;
    connect.mutate(connection, {
      onSuccess: async () => {
        await appWindow.setSize(new LogicalSize(1400, 900));
        await appWindow.center();
        navigate({ to: "/dashboard" });
      },
      onError: (error) => {
        toast.danger(error instanceof Error ? error.message : "Connection failed");
      },
    });
  };

  return (
    <div
      className={`group px-4 py-3 rounded-xl border border-separator bg-default transition-colors h-16 relative ${
        isConnecting ? "border-loading" : ""
      } ${isDisabled ? "opacity-50 pointer-events-none cursor-not-allowed" : "cursor-pointer hover:border-border"}`}
      onClick={handleConnect}
    >
      <div className="absolute inset-0 z-10 flex items-center gap-3 py-3 px-4">
        <ConnectionAvatar name={connection.name} type={connection.type} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{connection.name}</p>
          <p className="text-xs text-muted truncate mt-0.5">
            {connection.username}@{connection.host}:{connection.port}
            {connection.defaultDatabase ? ` · ${connection.defaultDatabase}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* DB type badge */}
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-secondary text-accent"
          >
            {DB_LABELS[connection.type]}
          </span>

          <div className="space-x-0.5" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="ghost"
              className={`min-w-0 px-2 h-7 transition-opacity opacity-0 group-hover:opacity-100`}
              onPress={() => onEdit(connection)}
              isDisabled={isAnyConnecting}
              aria-label="Edit connection"
            >
              <PencilLineIcon />
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className={`min-w-0 px-2 h-7 text-danger transition-opacity opacity-0 group-hover:opacity-100`}
              onPress={() => deleteConnection.mutate(connection.id)}
              isDisabled={deleteConnection.isPending || isAnyConnecting}
              aria-label="Remove connection"
            >
              {deleteConnection.isPending ? <Spinner size="sm" /> : <TrashIcon />}
            </Button>
          </div>

          {/* Chevron */}
          <svg
            className="w-4 h-4 text-muted opacity-60 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function ConnectionAvatar({ name }: { name: string; type: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0 bg-surface-secondary text-accent">
      {initials || "DB"}
    </div>
  );
}
