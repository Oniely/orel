import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { databaseQueryKeys, useApplyForeignKeyChanges, useApplyStructureChanges } from "./useTables";

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
      result.current.mutateAsync({ connectionId: "conn", database: "app", table: "orders", changes: { drops: ["x"], adds: [] } }),
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
      result.current.mutateAsync({ connectionId: "conn", database: "app", table: "orders", changes: { drops: [], adds: [] } }),
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
        changes: { edits: [], drops: ["email"], adds: [], reorder: null },
      }),
    );

    expect([own(), referencing()]).toEqual([true, true]);
    expect(otherDatabase()).toBe(false);
  });
});
