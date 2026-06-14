import { create } from "zustand";
import type { SavedConnection, ActiveConnection } from "../types/connection";

interface ConnectionStore {
  // --- Persisted (loaded from / saved to Rust) ---
  savedConnections: SavedConnection[];
  setSavedConnections: (connections: SavedConnection[]) => void;
  addSavedConnection: (connection: SavedConnection) => void;
  removeSavedConnection: (id: string) => void;
  updateSavedConnection: (id: string, updates: Partial<SavedConnection>) => void;

  // --- Runtime (lives only in memory while app is open) ---
  // Multiple connections can be open simultaneously
  activeConnections: Record<string, ActiveConnection>;

  // Which connection + database the user is currently looking at
  focusedConnectionId: string | null;
  setFocusedConnection: (id: string | null) => void;

  // Open a connection (adds it to activeConnections)
  openConnection: (config: SavedConnection) => void;

  // Close a connection (removes it from activeConnections)
  closeConnection: (id: string) => void;

  // Update runtime state of an open connection (status, databases list, etc.)
  updateActiveConnection: (id: string, updates: Partial<ActiveConnection>) => void;

  // Switch which database is active within an open connection
  setActiveDatabase: (connectionId: string, database: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  // Persisted
  savedConnections: [],
  setSavedConnections: (savedConnections) => set({ savedConnections }),
  addSavedConnection: (connection) =>
    set((state) => ({
      savedConnections: [...state.savedConnections, connection],
    })),
  removeSavedConnection: (id) =>
    set((state) => ({
      savedConnections: state.savedConnections.filter((c) => c.id !== id),
    })),
  updateSavedConnection: (id, updates) =>
    set((state) => ({
      savedConnections: state.savedConnections.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),
  // End Persisted

  // Runtime
  activeConnections: {},
  focusedConnectionId: null,

  setFocusedConnection: (id) => set({ focusedConnectionId: id }),

  openConnection: (config) =>
    set((state) => ({
      activeConnections: {
        ...state.activeConnections,
        [config.id]: {
          config,
          status: "connecting",
          databases: [],
          activeDatabase: config.defaultDatabase ?? null,
        },
      },
    })),

  closeConnection: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.activeConnections;
      return {
        activeConnections: rest,
        focusedConnectionId:
          state.focusedConnectionId === id ? (Object.keys(rest)[0] ?? null) : state.focusedConnectionId,
      };
    }),

  updateActiveConnection: (id, updates) =>
    set((state) => ({
      activeConnections: {
        ...state.activeConnections,
        [id]: { ...state.activeConnections[id], ...updates },
      },
    })),

  setActiveDatabase: (connectionId, database) =>
    set((state) => ({
      activeConnections: {
        ...state.activeConnections,
        [connectionId]: {
          ...state.activeConnections[connectionId],
          activeDatabase: database,
        },
      },
    })),
}));
