import { create } from "zustand";
import type { PendingChange, ColumnChange, RowIdentity } from "../types/write-queue";
import { identityKey } from "../types/write-queue";

interface TableChanges {
  /** Updates + Deletes keyed by identity key */
  changes: Map<string, PendingChange>;
  /** Insert drafts (no PK yet) */
  inserts: PendingChange[];
}

const emptyTable = (): TableChanges => ({ changes: new Map(), inserts: [] });

interface WriteQueueStore {
  tables: Record<string, TableChanges>;
  recentlySaved: Record<string, Map<string, string[]>>;

  stageUpdate: (scope: string, identity: RowIdentity, columnChanges: ColumnChange[]) => void;
  stageDelete: (scope: string, identity: RowIdentity) => void;
  stageInsert: (scope: string, values: Record<string, unknown>) => void;
  unstageRow: (scope: string, identity: RowIdentity) => void;
  removeInsert: (scope: string, index: number) => void;
  updateInsert: (scope: string, index: number, column: string, value: unknown) => void;
  clearTable: (scope: string) => void;
  clearAll: () => void;
  markRecentlySaved: (scope: string, entries: Array<[string, string[]]>) => void;
  clearRecentlySavedRow: (scope: string, identity: string) => void;

  // Read helpers (non-reactive — call inside components via getState or selectors)
  getChanges: (scope: string) => PendingChange[];
  getInserts: (scope: string) => PendingChange[];
  getChangeCount: (scope: string) => number;
  getRowChanges: (scope: string, identity: RowIdentity) => PendingChange[];
  getRowChangeKind: (scope: string, identity: RowIdentity) => "Update" | "Delete" | null;
  getCellChange: (scope: string, identity: RowIdentity, column: string) => ColumnChange | undefined;
}

export const useWriteQueueStore = create<WriteQueueStore>((set, get) => ({
  tables: {},
  recentlySaved: {},

  stageUpdate: (scope, identity, columnChanges) =>
    set((state) => {
      const table = state.tables[scope] ?? emptyTable();
      const key = identityKey(identity);
      const existing = table.changes.get(key);
      const next = new Map(table.changes);

      if (existing?.kind === "Delete") {
        // Row is marked for delete — don't allow edits
        return state;
      }

      if (existing?.kind === "Update") {
        // Merge new column changes into existing
        const merged = [...existing.changes];
        for (const change of columnChanges) {
          const idx = merged.findIndex((c) => c.column === change.column);
          if (idx >= 0) {
            // Keep original oldValue, update newValue
            merged[idx] = { ...merged[idx], newValue: change.newValue };
          } else {
            merged.push(change);
          }
        }
        // Remove no-op changes (newValue === oldValue)
        const filtered = merged.filter(
          (c) => JSON.stringify(c.newValue) !== JSON.stringify(c.oldValue),
        );
        if (filtered.length === 0) {
          next.delete(key);
        } else {
          next.set(key, { kind: "Update", identity, changes: filtered });
        }
      } else {
        // New update
        const filtered = columnChanges.filter(
          (c) => JSON.stringify(c.newValue) !== JSON.stringify(c.oldValue),
        );
        if (filtered.length > 0) {
          next.set(key, { kind: "Update", identity, changes: filtered });
        }
      }

      return { tables: { ...state.tables, [scope]: { ...table, changes: next } } };
    }),

  stageDelete: (scope, identity) =>
    set((state) => {
      const table = state.tables[scope] ?? emptyTable();
      const next = new Map(table.changes);
      next.set(identityKey(identity), { kind: "Delete", identity });
      return { tables: { ...state.tables, [scope]: { ...table, changes: next } } };
    }),

  stageInsert: (scope, values) =>
    set((state) => {
      const table = state.tables[scope] ?? emptyTable();
      return {
        tables: {
          ...state.tables,
          [scope]: { ...table, inserts: [...table.inserts, { kind: "Insert", values }] },
        },
      };
    }),

  unstageRow: (scope, identity) =>
    set((state) => {
      const table = state.tables[scope];
      if (!table) return state;
      const next = new Map(table.changes);
      next.delete(identityKey(identity));
      return { tables: { ...state.tables, [scope]: { ...table, changes: next } } };
    }),

  removeInsert: (scope, index) =>
    set((state) => {
      const table = state.tables[scope];
      if (!table) return state;
      return {
        tables: {
          ...state.tables,
          [scope]: { ...table, inserts: table.inserts.filter((_, i) => i !== index) },
        },
      };
    }),

  updateInsert: (scope, index, column, value) =>
    set((state) => {
      const table = state.tables[scope];
      if (!table) return state;
      const inserts = [...table.inserts];
      const insert = inserts[index];
      if (insert?.kind !== "Insert") return state;
      if (value === undefined) {
        const { [column]: _, ...rest } = insert.values;
        inserts[index] = { ...insert, values: rest };
      } else {
        inserts[index] = { ...insert, values: { ...insert.values, [column]: value } };
      }
      return { tables: { ...state.tables, [scope]: { ...table, inserts } } };
    }),

  clearTable: (scope) =>
    set((state) => {
      const { [scope]: _, ...rest } = state.tables;
      return { tables: rest };
    }),

  clearAll: () => set({ tables: {}, recentlySaved: {} }),

  markRecentlySaved: (scope, entries) =>
    set((state) => {
      const saved = new Map(state.recentlySaved[scope] ?? []);
      for (const [identity, columns] of entries) saved.set(identity, columns);
      return { recentlySaved: { ...state.recentlySaved, [scope]: saved } };
    }),

  clearRecentlySavedRow: (scope, identity) =>
    set((state) => {
      const current = state.recentlySaved[scope];
      if (!current?.has(identity)) return state;
      const saved = new Map(current);
      saved.delete(identity);
      if (saved.size === 0) {
        const { [scope]: _removed, ...remaining } = state.recentlySaved;
        return { recentlySaved: remaining };
      }
      return { recentlySaved: { ...state.recentlySaved, [scope]: saved } };
    }),

  getChanges: (scope) => {
    const table = get().tables[scope];
    if (!table) return [];
    return [...table.changes.values(), ...table.inserts];
  },

  getInserts: (scope) => {
    const table = get().tables[scope];
    if (!table) return [];
    return table.inserts;
  },

  getChangeCount: (scope) => {
    const table = get().tables[scope];
    if (!table) return 0;
    return table.changes.size + table.inserts.length;
  },

  getRowChanges: (scope, identity) => {
    const table = get().tables[scope];
    if (!table) return [];
    const change = table.changes.get(identityKey(identity));
    return change ? [change] : [];
  },

  getRowChangeKind: (scope, identity) => {
    const table = get().tables[scope];
    if (!table) return null;
    const change = table.changes.get(identityKey(identity));
    if (!change) return null;
    return change.kind as "Update" | "Delete";
  },

  getCellChange: (scope, identity, column) => {
    const table = get().tables[scope];
    if (!table) return undefined;
    const change = table.changes.get(identityKey(identity));
    if (change?.kind !== "Update") return undefined;
    return change.changes.find((c) => c.column === column);
  },
}));
