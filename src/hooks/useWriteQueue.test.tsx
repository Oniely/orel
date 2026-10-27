import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { databaseQueryKeys } from "./useTables";
import { useApplyRowChanges } from "./useWriteQueue";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ applied: [0], failed: null, notAttempted: [] });
});

describe("useApplyRowChanges", () => {
  it("resolves only after the visible rows have been refetched", async () => {
    // An on-screen rows query whose refetch we control
    let finishRefetch = () => {};
    const rowsKey = databaseQueryKeys.rowsForTable("conn", "app", "users");
    client.setQueryData(rowsKey, ["old"]);
    const observer = new QueryObserver(client, {
      queryKey: rowsKey,
      queryFn: () => new Promise<string[]>((resolve) => (finishRefetch = () => resolve(["new"]))),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    const { result } = renderHook(() => useApplyRowChanges("scope"), { wrapper });
    let resolved = false;
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .mutateAsync({ connectionId: "conn", database: "app", table: "users", changes: [] })
        .then(() => (resolved = true));
    });

    await vi.waitFor(() => expect(client.getQueryState(rowsKey)?.fetchStatus).toBe("fetching"));
    expect(resolved).toBe(false);

    await act(async () => {
      finishRefetch();
      await pending;
    });
    expect(resolved).toBe(true);
    expect(client.getQueryData(rowsKey)).toEqual(["new"]);
    unsubscribe();
  });
});
