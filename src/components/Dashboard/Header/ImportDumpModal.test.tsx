import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportDumpModal } from "./ImportDumpModal";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  importDump: {} as Record<string, unknown>,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../../hooks/useDump", () => ({ useImportDump: () => mocks.importDump }));

const missingTable = { message: "no such table: missing", line: 2, snippet: "INSERT INTO missing", hint: null };

function mockImport(overrides: Record<string, unknown>) {
  mocks.importDump = {
    status: "idle",
    isPending: false,
    data: undefined,
    error: null,
    progress: { done: 0, total: 0, errors: [] },
    mutate: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
  return mocks.importDump;
}

function renderModal() {
  render(<ImportDumpModal isOpen connectionId="c1" isMySql={false} onImported={vi.fn()} onClose={vi.fn()} />);
}

afterEach(cleanup);

describe("ImportDumpModal", () => {
  it("enables Import Now once a file is picked and imports it", async () => {
    const { mutate } = mockImport({});
    mocks.open.mockResolvedValue("/tmp/dump.sql");
    renderModal();
    const importNow = screen.getByRole<HTMLButtonElement>("button", { name: "Import Now" });
    expect(importNow.disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Browse" }));
    await waitFor(() => expect(importNow.disabled).toBe(false));
    await userEvent.click(importNow);
    expect(mutate).toHaveBeenCalledWith({ connectionId: "c1", filePath: "/tmp/dump.sql" }, expect.anything());
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    mockImport({});
    render(<ImportDumpModal isOpen connectionId="c1" isMySql={false} onImported={vi.fn()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows progress and errors live while importing", () => {
    mockImport({ status: "pending", isPending: true, progress: { done: 3, total: 4, errors: [missingTable] } });
    renderModal();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("75");
    expect(screen.getByText(/3 \/ 4 statements, 1 failed/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("no such table: missing");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled).toBe(true);
  });
});
