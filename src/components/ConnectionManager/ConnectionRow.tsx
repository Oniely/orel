import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useDeleteConnection, useConnect } from "../../hooks/useConnections";
import { SavedConnection } from "../../types/connection";
import { DB_COLORS, DB_LABELS } from "../../routes";
import { Button, Spinner } from "@heroui/react";

export default function ConnectionRow({ connection }: { connection: SavedConnection }) {
  const navigate = useNavigate();
  const deleteConnection = useDeleteConnection();
  const connect = useConnect(connection.id);
  const [hovered, setHovered] = useState(false);

  const handleConnect = () => {
    connect.mutate(connection, {
      onSuccess: () => navigate({ to: "/dashboard" }),
    });
  };

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-separator bg-surface hover:border-default-300 transition-colors cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ConnectionAvatar name={connection.name} type={connection.type} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{connection.name}</p>
        <p className="text-xs text-default-400 truncate mt-0.5">
          {connection.username}@{connection.host}:{connection.port}
          {connection.defaultDatabase ? ` · ${connection.defaultDatabase}` : ""}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* DB type badge */}
        <span
          className="text-[11px] font-medium px-2 py-0.5 rounded-full"
          style={{
            background: `${DB_COLORS[connection.type]}15`,
            color: DB_COLORS[connection.type],
          }}
        >
          {DB_LABELS[connection.type]}
        </span>

        {/* Connect button — visible on hover */}
        <Button
          size="sm"
          variant="outline"
          className={`min-w-0 px-2.5 h-7 text-xs transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}
          onPress={handleConnect}
          isDisabled={connect.isPending || deleteConnection.isPending}
          aria-label="Connect"
        >
          {connect.isPending ? <Spinner size="sm" /> : "Connect"}
        </Button>

        {/* Delete button — visible on hover */}
        <Button
          size="sm"
          variant="ghost"
          className={`min-w-0 px-2 h-7 text-danger transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}
          onPress={() => deleteConnection.mutate(connection.id)}
          isDisabled={deleteConnection.isPending || connect.isPending}
          aria-label="Remove connection"
        >
          {deleteConnection.isPending ? (
            <Spinner size="sm" />
          ) : (
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          )}
        </Button>

        {/* Chevron */}
        <svg
          className="w-4 h-4 text-default-300 shrink-0"
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
  );
}

function ConnectionAvatar({ name, type }: { name: string; type: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0"
      style={{
        background: `${DB_COLORS[type]}20`,
        color: DB_COLORS[type],
      }}
    >
      {initials || "DB"}
    </div>
  );
}
