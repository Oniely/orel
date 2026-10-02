import { useCallback, type SetStateAction } from "react";
import { create } from "zustand";
import type { StructureDraftTab, StructureDrafts } from "../types/structure-drafts";

// Staged Structure-view changes, kept per table and tab until that tab saves or
// cancels, so switching tabs, tables, or the Data/Structure view doesn't lose them
// (the same way the write queue keeps staged row edits). Keyed by the dashboard's
// table scopeKey, so a same-named table in another database never shares a draft.

// Stable references, so selecting a table with no draft doesn't re-render every time
const EMPTY_DRAFTS: StructureDrafts = {
  columns: { edits: {}, deletes: [], adds: [], reorder: null },
  indexes: { drops: [], adds: [] },
  foreignKeys: { drops: [], adds: [] },
};

type DraftsByScope = { [T in StructureDraftTab]: Record<string, StructureDrafts[T]> };

/** Tabs whose draft holds a list of new rows */
type AddableTab = "indexes" | "foreignKeys";

// A draft with nothing staged, e.g. after every change was undone
function isEmptyDraft(draft: object): boolean {
  return Object.values(draft).every(
    (v) => v === null || (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0),
  );
}

interface StructureDraftsStore {
  drafts: DraftsByScope;
  updateDraft: <T extends StructureDraftTab>(
    tab: T,
    scopeKey: string,
    update: (draft: StructureDrafts[T]) => StructureDrafts[T],
  ) => void;
  /** Stages a new row, e.g. one pre-filled by the Columns tab's Key menu */
  stageAdd: <T extends AddableTab>(tab: T, scopeKey: string, row: StructureDrafts[T]["adds"][number]) => void;
  clearDraft: (tab: StructureDraftTab, scopeKey: string) => void;
}

export const useStructureDraftsStore = create<StructureDraftsStore>((set, get) => ({
  drafts: { columns: {}, indexes: {}, foreignKeys: {} },

  updateDraft: (tab, scopeKey, update) =>
    set((state) => {
      const byScope: Record<string, StructureDrafts[typeof tab]> = state.drafts[tab];
      const { [scopeKey]: previous, ...rest } = byScope;
      const next = update(previous ?? EMPTY_DRAFTS[tab]);
      // Undoing every change drops the entry instead of keeping an empty draft around
      return { drafts: { ...state.drafts, [tab]: isEmptyDraft(next) ? rest : { ...rest, [scopeKey]: next } } };
    }),

  stageAdd: (tab, scopeKey, row) =>
    get().updateDraft(tab, scopeKey, (draft) => ({ ...draft, adds: [...draft.adds, row] })),

  clearDraft: (tab, scopeKey) =>
    set((state) => {
      if (!(scopeKey in state.drafts[tab])) return state;
      const { [scopeKey]: _cleared, ...rest } = state.drafts[tab];
      return { drafts: { ...state.drafts, [tab]: rest } };
    }),
}));

/**
 * One field of a tab's draft, used like `useState`: the value plus a setter that
 * takes a value or an updater.
 */
export function useStructureDraftField<T extends StructureDraftTab, K extends keyof StructureDrafts[T]>(
  tab: T,
  scopeKey: string,
  field: K,
): [StructureDrafts[T][K], (action: SetStateAction<StructureDrafts[T][K]>) => void] {
  const value = useStructureDraftsStore((s) => (s.drafts[tab][scopeKey] ?? EMPTY_DRAFTS[tab])[field]);
  const setValue = useCallback(
    (action: SetStateAction<StructureDrafts[T][K]>) =>
      useStructureDraftsStore.getState().updateDraft(tab, scopeKey, (draft) => ({
        ...draft,
        [field]: typeof action === "function" ? (action as (prev: StructureDrafts[T][K]) => StructureDrafts[T][K])(draft[field]) : action,
      })),
    [tab, scopeKey, field],
  );
  return [value, setValue];
}
