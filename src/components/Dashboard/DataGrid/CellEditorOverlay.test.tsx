import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CellEditorOverlay } from "./CellEditorOverlay";

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

  function renderDateEditor(dataType: string, initialValue: string, onCommit: (value: string) => string | null) {
    const containerRef = { current: document.createElement("div") };
    containerRef.current.innerHTML = '<table><tbody><tr><td data-cell="0::at"></td></tr></tbody></table>';
    render(
      <CellEditorOverlay
        containerRef={containerRef}
        cellAttr="0::at"
        initialValue={initialValue}
        dataType={dataType}
        isNullable
        onCommit={onCommit}
        onCancel={vi.fn()}
        onAdvance={vi.fn()}
        onExpand={vi.fn()}
      />,
    );
    return screen.getByRole<HTMLInputElement>("textbox");
  }

  it("has no date picker for non-date columns", () => {
    render(<Harness onCommit={() => null} onExpand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Pick date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
  });

  it("fills a timestamptz cell with the current time via Now without committing early", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn(() => null);
    const input = renderDateEditor("timestamptz", "2024-01-15T10:30:00+05:30", onCommit);
    expect(screen.getByRole("button", { name: "Pick date" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Now" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(input.value);
  });

  it("writes the date picked in the calendar popover into the input", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn(() => null);
    const input = renderDateEditor("date", "2024-01-15", onCommit);
    await user.click(screen.getByRole("button", { name: "Pick date" }));
    await user.click(await screen.findByRole("button", { name: /January 20, 2024/ }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("2024-01-20");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("2024-01-20");
  });

  it("keeps the time and offset when picking a new date for a timestamptz", async () => {
    const user = userEvent.setup();
    const input = renderDateEditor("timestamptz", "2024-01-15T10:30:00.25+05:30", vi.fn(() => null));
    await user.click(screen.getByRole("button", { name: "Pick date" }));
    await user.click(await screen.findByRole("button", { name: /January 3, 2024/ }));
    expect(input.value).toBe("2024-01-03T10:30:00.25+05:30");
  });
});
