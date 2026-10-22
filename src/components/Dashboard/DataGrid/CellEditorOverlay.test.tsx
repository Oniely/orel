import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
