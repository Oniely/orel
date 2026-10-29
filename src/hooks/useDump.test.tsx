import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { useImportDump } from "./useDump";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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
});
