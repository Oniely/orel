import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { useActiveTable } from "./useActiveTable";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./useDashboardContext", () => ({
  useDashboardContext: () => ({
    connectionId: "conn",
    activeDatabase: "app",
    activeTableName: "users",
    scopeKey: "conn::app::users",
  }),
}));
vi.mock("../../stores/dashboard.store", () => ({
  EMPTY_FILTER_STATE: { applied: [] },
  DEFAULT_PAGINATION: { page: 1, limit: 100 },
  useDashboardStore: (select: (state: unknown) => unknown) =>
    select({ tableFilters: {}, tablePagination: {}, setPage: vi.fn() }),
}));
vi.mock("../useWriteQueueActions", () => ({ useWriteQueueActions: () => ({}) }));

const invokeMock = vi.mocked(invoke);
const result = (name: string) => ({ columns: [], rows: [{ name }], totalResults: 1, totalPages: 1 });

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invokeMock.mockReset();
});

describe("useActiveTable", () => {
  it("keeps showing rows instead of a loading state while refetching after a save", async () => {
    invokeMock.mockResolvedValueOnce(result("old"));
    const { result: hook } = renderHook(() => useActiveTable(), { wrapper });
    await waitFor(() => expect(hook.current.rows).toEqual([{ name: "old" }]));

    let finish = () => {};
    invokeMock.mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve(result("new")))));
    act(() => void client.invalidateQueries());

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(hook.current.isLoading).toBe(false);
    expect(hook.current.rows).toEqual([{ name: "old" }]);

    await act(async () => finish());
    await waitFor(() => expect(hook.current.rows).toEqual([{ name: "new" }]));
  });
});
