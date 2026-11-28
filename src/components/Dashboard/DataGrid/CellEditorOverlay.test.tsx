import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CellEditorOverlay } from "./CellEditorOverlay";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function Harness(props: { onCommit: (value: string) => string | null; onExpand: (value: string) => void; onAdvance?: () => void }) {
  // The grid container (and its cell) exists before the overlay mounts, as in DataGrid
  const containerRef = useRef<HTMLDivElement | null>(null);
  if (!containerRef.current) {
    containerRef.current = document.createElement("div");
    containerRef.current.innerHTML = '<table><tbody><tr><td data-cell="0::doc"></td></tr></tbody></table>';
  }
  return (
    <CellEditorOverlay
      containerRef={containerRef}
      cellAttr="0::doc"
      initialValue='{"a":1}'
      dataType="jsonb"
      onCancel={vi.fn()}
      onAdvance={props.onAdvance ?? vi.fn()}
      onCommit={props.onCommit}
      onExpand={props.onExpand}
    />
  );
}

afterEach(cleanup);

describe("CellEditorOverlay", () => {
  it("keeps the editor open and flags the error when a commit is rejected", () => {
    const onCommit = vi.fn(() => "Invalid JSON: Unexpected token");
    const onAdvance = vi.fn();
    render(<Harness onCommit={onCommit} onExpand={vi.fn()} onAdvance={onAdvance} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "{oops" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("{oops");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("moves rejected text to the expanded editor on blur instead of dropping it", () => {
    const onExpand = vi.fn();
    render(<Harness onCommit={() => "Invalid JSON"} onExpand={onExpand} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "{oops" } });
    fireEvent.blur(input);
    expect(onExpand).toHaveBeenCalledWith("{oops");
  });

  it("offers ENUM values as a dropdown and commits the picked one", () => {
    const containerRef = { current: document.createElement("div") };
    containerRef.current.innerHTML = '<table><tbody><tr><td data-cell="0::status"></td></tr></tbody></table>';
    const onCommit = vi.fn(() => null);
    render(
      <CellEditorOverlay
        containerRef={containerRef}
        cellAttr="0::status"
        initialValue="pending"
        dataType="enum"
        isNullable
        enumValues={["pending", "shipped"]}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onAdvance={vi.fn()}
        onExpand={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["NULL", "pending", "shipped"]);
    fireEvent.change(select, { target: { value: "shipped" } });
    expect(onCommit).toHaveBeenCalledWith("shipped");
  });

  describe("foreign key columns", () => {
    const fkCell = { connectionId: "conn", database: "app", table: "orders", column: "user_id" };
    const fkArgs = (search: string) => ({ connectionId: "conn", table: "orders", column: "user_id", search });
    const users = [
      { value: "1", label: "Ada Lovelace" },
      { value: "2", label: "Alan Turing" },
    ];

    function renderFk(onCommit: (value: string) => string | null) {
      const containerRef = { current: document.createElement("div") };
      containerRef.current.innerHTML = '<table><tbody><tr><td data-cell="0::user_id"></td></tr></tbody></table>';
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <CellEditorOverlay
            containerRef={containerRef}
            cellAttr="0::user_id"
            initialValue="2"
            dataType="integer"
            isNullable
            fkCell={fkCell}
            onCommit={onCommit}
            onCancel={vi.fn()}
            onAdvance={vi.fn()}
            onExpand={vi.fn()}
          />
        </QueryClientProvider>,
      );
      return screen.getByRole("combobox");
    }

    beforeEach(() => {
      invokeMock.mockReset();
      invokeMock.mockImplementation(async (_cmd, args) => {
        const search = String((args as { search: string }).search).toLowerCase();
        return users.filter((u) => `${u.value} ${u.label}`.toLowerCase().includes(search));
      });
    });

    it("lists referenced keys with labels and stages the picked one", async () => {
      const onCommit = vi.fn(() => null);
      renderFk(onCommit);
      // The current value doesn't filter the first list
      await screen.findByText("Alan Turing");
      expect(invokeMock).toHaveBeenCalledWith("fetch_fk_options", fkArgs(""));
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["NULL", "1Ada Lovelace", "2Alan Turing"]);
      fireEvent.mouseDown(screen.getByText("Ada Lovelace"));
      expect(onCommit).toHaveBeenCalledWith("1");
    });

    it("searches on the server after typing and still accepts typed text", async () => {
      const onCommit = vi.fn(() => null);
      const input = renderFk(onCommit);
      await screen.findByText("Alan Turing");
      fireEvent.change(input, { target: { value: "ada" } });
      await waitFor(() => expect(screen.queryByText("Alan Turing")).toBeNull());
      expect(invokeMock).toHaveBeenLastCalledWith("fetch_fk_options", fkArgs("ada"));
      fireEvent.change(input, { target: { value: "99" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onCommit).toHaveBeenCalledWith("99");
    });

    it("picks NULL with the keyboard on a nullable column", async () => {
      const onCommit = vi.fn(() => null);
      const input = renderFk(onCommit);
      await screen.findByText("Alan Turing");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onCommit).toHaveBeenCalledWith("");
    });
  });
});
