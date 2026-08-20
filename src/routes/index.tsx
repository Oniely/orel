import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertDialog, Button, Spinner } from "@heroui/react";
import { ConnectionModal } from "../components/ConnectionModal";
import { useDeleteConnection, useLoadConnections } from "../hooks/useConnections";
import { useConnectionStore } from "../stores/connection.store";
import type { SavedConnection } from "../types/connection";
import ConnectionRow from "../components/ConnectionManager/ConnectionRow";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { SettingsButton } from "../components/SettingsButton";

export const Route = createFileRoute("/")({
  component: ConnectionManager,
});

export const DB_COLORS: Record<string, string> = {
  postgres: "#378ADD",
  mysql: "#EF9F27",
  sqlite: "#59A3D5",
};

export const DB_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
};
const appWindow = getCurrentWindow();

function ConnectionManager() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null);
  const [deletingConnection, setDeletingConnection] = useState<SavedConnection | null>(null);
  const { savedConnections } = useConnectionStore();
  const { isLoading, error } = useLoadConnections();
  const deleteConnection = useDeleteConnection();

  const handleEdit = (connection: SavedConnection) => {
    setEditingConnection(connection);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingConnection(null);
  };

  useEffect(() => {
    appWindow.setSize(new LogicalSize(1280, 720));
    appWindow.center();
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Orel</h1>
            <p className="text-sm text-muted mt-0.5">
              {savedConnections.length === 0
                ? "No connections yet"
                : `${savedConnections.length} connection${savedConnections.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SettingsButton />
            <Button
              size="sm"
              variant="outline"
              onPress={() => {
                setEditingConnection(null);
                setModalOpen(true);
              }}
            >
              <svg
                className="w-3.5 h-3.5 mr-1"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              New connection
            </Button>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-16">
            <Spinner size="sm" />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && <p className="text-sm text-danger text-center py-8">Failed to load connections</p>}

        {/* Empty state */}
        {!isLoading && !error && savedConnections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-surface border border-separator flex items-center justify-center">
              <svg
                className="w-5 h-5 text-muted opacity-60"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No connections</p>
              <p className="text-xs text-muted mt-1">Add your first database connection to get started</p>
            </div>
            <Button size="sm" variant="outline" onPress={() => setModalOpen(true)} className="mt-1">
              Add connection
            </Button>
          </div>
        )}

        {/* Connection list */}
        {!isLoading && savedConnections.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Saved connections</p>
            {savedConnections.map((conn) => (
              <ConnectionRow key={conn.id} connection={conn} onEdit={handleEdit} onDelete={setDeletingConnection} />
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <ConnectionModal
          key={editingConnection?.id ?? "new"}
          isOpen={modalOpen}
          onClose={handleCloseModal}
          connection={editingConnection ?? undefined}
        />
      )}

      <AlertDialog>
        <AlertDialog.Backdrop
          isOpen={!!deletingConnection}
          isDismissable={!deleteConnection.isPending}
          isKeyboardDismissDisabled={deleteConnection.isPending}
          onOpenChange={(open) => {
            if (!open && !deleteConnection.isPending) setDeletingConnection(null);
          }}
        >
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>Delete connection?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  Are you sure you want to <span className="text-danger">delete</span>{" "}
                  <strong className="text-accent">
                    <u>{deletingConnection?.name}</u>
                  </strong>
                  ? This cannot be undone.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="outline"
                  isDisabled={deleteConnection.isPending}
                  onPress={() => setDeletingConnection(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-danger text-white"
                  isDisabled={deleteConnection.isPending}
                  onPress={() => {
                    if (!deletingConnection) return;
                    deleteConnection.mutate(deletingConnection.id, {
                      onSuccess: () => setDeletingConnection(null),
                    });
                  }}
                >
                  {deleteConnection.isPending ? <Spinner size="sm" /> : "Delete"}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
