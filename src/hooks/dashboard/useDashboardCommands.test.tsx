import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseQueryKeys } from "../useTables";
import { useDashboardCommands } from "./useDashboardCommands";

const toastSuccess = vi.fn();

vi.mock("@heroui/react", () => ({ toast: { success: (msg: string) => toastSuccess(msg), warning: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../useConnections", () => ({ useDisconnect: () => ({}), useSwitchDatabase: () => ({}) }));
vi.mock("../../stores/dashboard.store", () => ({
  getActiveEditorIds: () => [],
  useDashboardStoreApi: () => ({ getState: () => ({}) }),
}));
vi.mock("./useDashboardContext", () => ({
  useDashboardContext: () => ({
    connectionId: "c",
    activeDatabase: "db",
    databaseKey: "c::db",
    openTabs: [],
    activeTabId: null,
  }),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolveRows: () => void = () => {};
  const rowsFn = vi.fn(() => new Promise<string[]>((resolve) => (resolveRows = () => resolve(["row"]))));
  queryClient.setQueryData(databaseQueryKeys.rows("c", "db", "users", 50, 1, []), ["old"]);
  queryClient.getQueryCache().find({ queryKey: databaseQueryKeys.rows("c", "db", "users", 50, 1, []) })!.setOptions({
    queryKey: databaseQueryKeys.rows("c", "db", "users", 50, 1, []),
    queryFn: rowsFn,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useDashboardCommands(), { wrapper });
  return { result, rowsFn, resolve: () => resolveRows() };
}

beforeEach(() => toastSuccess.mockClear());

describe("useDashboardCommands refresh", () => {
  it("refetches the active database's rows", async () => {
    const { result, rowsFn, resolve } = setup();
    const done = result.current.refresh();
    await waitFor(() => expect(rowsFn).toHaveBeenCalledTimes(1));
    resolve();
    await done;
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("manualRefresh confirms with a toast only after the refetch finishes", async () => {
    const { result, rowsFn, resolve } = setup();
    const done = result.current.manualRefresh();
    await waitFor(() => expect(rowsFn).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    resolve();
    await done;
    expect(toastSuccess).toHaveBeenCalledWith("Refreshed");
  });
});
