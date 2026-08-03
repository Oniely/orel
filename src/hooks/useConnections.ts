import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@heroui/react";
import { useConnectionStore } from "../stores/connection.store";
import type { SavedConnection } from "../types/connection";
import { getErrorMessage } from "../lib/error";

// Load all saved connections from Rust on mount
export function useLoadConnections() {
  const setSavedConnections = useConnectionStore((s) => s.setSavedConnections);

  return useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const connections = await invoke<SavedConnection[]>("load_connections");
      setSavedConnections(connections); // sync into Zustand for UI access
      return connections;
    },
  });
}

// Save a new connection
export function useSaveConnection() {
  const queryClient = useQueryClient();
  const addSavedConnection = useConnectionStore((s) => s.addSavedConnection);

  return useMutation({
    mutationFn: (config: SavedConnection) => invoke("save_connection", { config }),
    onSuccess: (_, config) => {
      addSavedConnection(config);
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Connection saved");
    },
    onError: (error) => {
      toast.danger(getErrorMessage(error, "Failed to save connection"));
    },
  });
}

// Update a connection
export function useUpdateConnection() {
  const queryClient = useQueryClient();
  const updateSavedConnection = useConnectionStore((s) => s.updateSavedConnection);

  return useMutation({
    mutationFn: (config: SavedConnection) => invoke("update_connection", { config }),
    onSuccess: (_, config) => {
      updateSavedConnection(config.id, config);
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Connection updated");
    },
    onError: (error) => {
      toast.danger(getErrorMessage(error, "Failed to update connection"));
    },
  });
}

// Delete a connection
export function useDeleteConnection() {
  const queryClient = useQueryClient();
  const removeSavedConnection = useConnectionStore((s) => s.removeSavedConnection);

  return useMutation({
    mutationFn: (id: string) => invoke("delete_connection", { id }),
    onSuccess: (_, id) => {
      removeSavedConnection(id);
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Connection deleted");
    },
    onError: (error) => {
      toast.danger(getErrorMessage(error, "Failed to delete connection"));
    },
  });
}

// Test a connection without saving
export function useTestConnection() {
  return useMutation({
    mutationFn: (config: Partial<SavedConnection>) => invoke<string>("test_connection", { config }),
  });
}

// Connect to a server and get its list of databases
export function useConnect() {
  const { openConnection, updateActiveConnection, setFocusedConnection } = useConnectionStore();

  return useMutation({
    mutationFn: async (config: SavedConnection) => {
      openConnection(config);
      const result = await invoke<{ databases: string[]; activeDatabase: string }>("connect", { config });
      return result;
    },
    onSuccess: (result, config) => {
      updateActiveConnection(config.id, {
        status: "connected",
        databases: result.databases,
        activeDatabase: result.activeDatabase,
      });
      setFocusedConnection(config.id);
    },
    onError: (error, config) => {
      updateActiveConnection(config.id, {
        status: "error",
        error: getErrorMessage(error, "Connection failed"),
      });
    },
  });
}

// Load all databases for an active connection
export function useListDatabases(connectionId: string | null, enabled = true) {
  const updateActiveConnection = useConnectionStore((s) => s.updateActiveConnection);

  return useQuery({
    queryKey: ["databases", connectionId],
    queryFn: async () => {
      const databases = await invoke<string[]>("list_databases", { connectionId: connectionId! });
      updateActiveConnection(connectionId!, { databases });
      return databases;
    },
    enabled: !!connectionId && enabled,
    staleTime: 30_000,
  });
}

// Disconnect from a server and clean up
export function useDisconnect() {
  const queryClient = useQueryClient();
  const closeConnection = useConnectionStore((s) => s.closeConnection);

  return useMutation({
    mutationFn: (id: string) => invoke("disconnect", { id }),
    onSuccess: (_, id) => {
      closeConnection(id);
      queryClient.invalidateQueries({ queryKey: ["tables", id] });
    },
  });
}

export function useSwitchDatabase() {
  const updateActiveConnection = useConnectionStore((s) => s.updateActiveConnection);

  return useMutation({
    mutationFn: (input: { connectionId: string; database: string }) => invoke("switch_database", input),
    onSuccess: (_, { connectionId, database }) => {
      updateActiveConnection(connectionId, { activeDatabase: database, error: undefined });
    },
    onError: (error, { connectionId }) => {
      updateActiveConnection(connectionId, {
        error: getErrorMessage(error, "Failed to switch database"),
      });
    },
  });
}
