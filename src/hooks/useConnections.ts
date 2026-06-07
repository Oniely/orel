import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useConnectionStore } from "../stores/connection.store";
import type { SavedConnection } from "../types/connection";

// Load all saved connections from Rust on mount
export function useSavedConnections() {
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
export function useConnect(connectionId: string) {
  const { openConnection, updateActiveConnection } = useConnectionStore();

  return useMutation({
    mutationFn: async (config: SavedConnection) => {
      openConnection(config);
      const databases = await invoke<string[]>("connect", { config });
      return databases;
    },
    onSuccess: (databases) => {
      updateActiveConnection(connectionId, {
        status: "connected",
        databases,
      });
    },
    onError: (error) => {
      updateActiveConnection(connectionId, {
        status: "error",
        error: error instanceof Error ? error.message : "Connection failed",
      });
    },
  });
}

// Load all databases for an active connection
export function useListDatabases(connectionId: string | null, enabled = true) {
  const updateActiveConnection = useConnectionStore((s) => s.updateActiveConnection);

  const query = useQuery({
    queryKey: ["databases", connectionId],
    queryFn: () => invoke<string[]>("list_databases", { connectionId: connectionId! }),
    enabled: !!connectionId && enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!connectionId || !query.data) return;
    updateActiveConnection(connectionId, { databases: query.data });
  }, [connectionId, query.data, updateActiveConnection]);

  return query;
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
        error: error instanceof Error ? error.message : "Failed to switch database",
      });
    },
  });
}
