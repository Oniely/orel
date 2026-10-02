import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { useStructureDraftsStore } from "../stores/structure-drafts.store";
import {
  databaseQueryKeys,
  useApplyForeignKeyChanges,
  useApplyIndexChanges,
  useApplyStructureChanges,
} from "./useTables";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Seeds a cached query and reports whether it has been marked stale since */
function seed(queryKey: readonly unknown[]) {
  client.setQueryData(queryKey, []);
  return () => client.getQueryState(queryKey)?.isInvalidated ?? false;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("useApplyForeignKeyChanges", () => {
  it("refreshes everything a foreign key save changes, and nothing else", async () => {
    const k = databaseQueryKeys;
    const foreignKeys = seed(k.tableForeignKeys("conn", "app", "orders"));
    const structure = seed(k.tableStructure("conn", "app", "orders"));
    const ddl = seed(k.tableDdl("conn", "app", "orders"));
    // MySQL indexes a new foreign key's column
    const indexes = seed(k.tableIndexes("conn", "app", "orders"));
    const otherTable = seed(k.tableForeignKeys("conn", "app", "users"));
    const rows = seed(k.rowsForTable("conn", "app", "orders"));

    const { result } = renderHook(() => useApplyForeignKeyChanges(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ connectionId: "conn", database: "app", table: "orders", scopeKey: "scope", changes: { drops: ["x"], adds: [] } }),
    );

    expect(invokeMock).toHaveBeenCalledWith("apply_foreign_key_changes", {
      connectionId: "conn",
      table: "orders",
      changes: { drops: ["x"], adds: [] },
    });
    expect([foreignKeys(), structure(), ddl(), indexes()]).toEqual([true, true, true, true]);
    expect([otherTable(), rows()]).toEqual([false, false]);
  });

  it("marks the structure stale without refetching it", async () => {
    const structureKey = databaseQueryKeys.tableStructure("conn", "app", "orders");
    const refetch = vi.fn().mockResolvedValue({ columns: [], dialect: "postgres" });
    // An active structure query, like the Foreign Keys tab's own
    client.setQueryData(structureKey, { columns: [], dialect: "postgres" });
    // staleTime keeps subscribing from fetching; only an invalidation could
    const observer = new QueryObserver(client, { queryKey: structureKey, queryFn: refetch, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});

    const { result } = renderHook(() => useApplyForeignKeyChanges(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ connectionId: "conn", database: "app", table: "orders", scopeKey: "scope", changes: { drops: [], adds: [] } }),
    );

    expect(client.getQueryState(structureKey)?.isInvalidated).toBe(true);
    expect(refetch).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("useApplyStructureChanges", () => {
  it("refreshes foreign keys across the database, since other tables can reference the changed columns", async () => {
    const k = databaseQueryKeys;
    const own = seed(k.tableForeignKeys("conn", "app", "users"));
    const referencing = seed(k.tableForeignKeys("conn", "app", "orders"));
    const otherDatabase = seed(k.tableForeignKeys("conn", "archive", "orders"));

    const { result } = renderHook(() => useApplyStructureChanges(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        connectionId: "conn",
        database: "app",
        table: "users",
        scopeKey: "scope",
        changes: { edits: [], drops: ["email"], adds: [], reorder: null },
      }),
    );

    expect([own(), referencing()]).toEqual([true, true]);
    expect(otherDatabase()).toBe(false);
  });
});

describe("staged drafts after a save", () => {
  const cases = [
    { name: "columns", tab: "columns", hook: useApplyStructureChanges, changes: { edits: [], drops: [], adds: [], reorder: null } },
    { name: "indexes", tab: "indexes", hook: useApplyIndexChanges, changes: { drops: [], adds: [] } },
    { name: "foreign keys", tab: "foreignKeys", hook: useApplyForeignKeyChanges, changes: { drops: [], adds: [] } },
  ] as const;

  it.each(cases)("clears the $name draft even when the tab unmounts before the save returns", async ({ tab, hook, changes }) => {
    const store = useStructureDraftsStore.getState();
    store.updateDraft(tab, "scope", (draft) => ({ ...draft, drops: ["x"] }));
    expect("scope" in useStructureDraftsStore.getState().drafts[tab]).toBe(true);

    let resolveSave: (value: string[]) => void = () => {};
    invokeMock.mockReturnValue(new Promise<string[]>((resolve) => (resolveSave = resolve)));

    const { result, unmount } = renderHook(() => hook(), { wrapper });
    // Per-call callbacks are dropped on unmount, like the ones the tabs used to rely on
    const perCall = vi.fn();
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result.current as any).mutate(
        { connectionId: "conn", database: "app", table: "orders", scopeKey: "scope", changes },
        { onSuccess: perCall },
      );
    });
    unmount();
    await act(async () => {
      resolveSave([]);
      await Promise.resolve();
    });

    expect(perCall).not.toHaveBeenCalled();
    await vi.waitFor(() => expect("scope" in useStructureDraftsStore.getState().drafts[tab]).toBe(false));
  });
});
