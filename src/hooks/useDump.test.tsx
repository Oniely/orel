import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { type Channel, invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import type { ImportProgress } from "../types/dump";
import { useImportDump } from "./useDump";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    constructor(public onmessage: (message: unknown) => void) {}
  },
}));

const invokeMock = vi.mocked(invoke);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useImportDump", () => {
  it("resolves with the summary, errors included, on a partial import", async () => {
    const summary = {
      statementsExecuted: 2,
      statementsFailed: 1,
      tablesAffected: 1,
      errors: [{ message: "relation already exists", line: 3, snippet: "CREATE TABLE users", hint: null }],
    };
    invokeMock.mockResolvedValueOnce(summary);
    const { result } = renderHook(() => useImportDump(), { wrapper });

    result.current.mutate({ connectionId: "c1", filePath: "/tmp/x.sql" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(summary);
  });

  it("rejects with a plain message when nothing could run at all", async () => {
    invokeMock.mockRejectedValueOnce("Couldn't read /tmp/missing.sql: No such file or directory");
    const { result } = renderHook(() => useImportDump(), { wrapper });

    result.current.mutate({ connectionId: "c1", filePath: "/tmp/missing.sql" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe("Couldn't read /tmp/missing.sql: No such file or directory");
  });

  it("falls back to a generic message for a non-string rejection", async () => {
    invokeMock.mockRejectedValueOnce(undefined);
    const { result } = renderHook(() => useImportDump(), { wrapper });

    result.current.mutate({ connectionId: "c1", filePath: "/tmp/x.sql" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe("Import failed");
  });

  it("collects live progress and errors from the channel", async () => {
    let resolve: (summary: unknown) => void = () => {};
    invokeMock.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useImportDump(), { wrapper });

    result.current.mutate({ connectionId: "c1", filePath: "/tmp/x.sql" });
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    const { onProgress } = invokeMock.mock.lastCall![1] as { onProgress: Channel<ImportProgress> };
    const error = { message: "boom", line: 2, snippet: "INSERT", hint: null };
    act(() => {
      onProgress.onmessage({ done: 1, total: 3, error: null });
      onProgress.onmessage({ done: 2, total: 3, error });
    });
    expect(result.current.progress).toEqual({ done: 2, total: 3, errors: [error] });
    resolve({ statementsExecuted: 2, statementsFailed: 1, tablesAffected: 0, errors: [error] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
