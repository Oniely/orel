import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "../../../types/database";
import { ValueEditorModal } from "./ValueEditorModal";

vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos" }));
vi.mock("../../../stores/theme.store", () => ({
  useThemeStore: (select: (state: { themeId: string }) => unknown) => select({ themeId: "dark" }),
}));
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="value editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const jsonColumn: ColumnInfo = { name: "doc", dataType: "jsonb", isNullable: true, isPrimary: false, hasDefault: false };
const textColumn: ColumnInfo = { name: "bio", dataType: "text", isNullable: false, isPrimary: false, hasDefault: false };

function renderModal(column: ColumnInfo, value: unknown) {
  const props = { onApply: vi.fn(), onSetNull: vi.fn(), onCancel: vi.fn() };
  render(<ValueEditorModal table="users" column={column} value={value} original={value} {...props} />);
  return props;
}

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("value editor");

afterEach(cleanup);

describe("ValueEditorModal", () => {
  it("pretty-prints JSON and shows table.column with the data type", () => {
    renderModal(jsonColumn, { a: 1 });
    expect(editor().value).toBe('{\n  "a": 1\n}');
    expect(screen.getByText("users.doc")).toBeTruthy();
    expect(screen.getByText("jsonb")).toBeTruthy();
  });

  it("disables Apply and shows the error while JSON is invalid", () => {
    const { onApply } = renderModal(jsonColumn, { a: 1 });
    fireEvent.change(editor(), { target: { value: '{\n  "a" 1\n}' } });
    expect(screen.getByRole("alert").textContent).toMatch(/Invalid JSON.*line 2, col 7/);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Apply/ }).disabled).toBe(true);
    fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("formats valid JSON and applies the text with mod+Enter", () => {
    const { onApply } = renderModal(jsonColumn, null);
    fireEvent.change(editor(), { target: { value: '{"b":[1,2]}' } });
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(editor().value).toBe('{\n  "b": [\n    1,\n    2\n  ]\n}');
    fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
    expect(onApply).toHaveBeenCalledWith('{\n  "b": [\n    1,\n    2\n  ]\n}');
  });

  it("cancels on Escape without letting the event reach document listeners", () => {
    const { onCancel } = renderModal(textColumn, "hello");
    const docListener = vi.fn();
    document.addEventListener("keydown", docListener);
    fireEvent.keyDown(editor(), { key: "Escape" });
    document.removeEventListener("keydown", docListener);
    expect(onCancel).toHaveBeenCalled();
    expect(docListener).not.toHaveBeenCalled();
  });

  it("only offers Set NULL for nullable columns", async () => {
    const { onSetNull } = renderModal(jsonColumn, { a: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Set NULL" }));
    expect(onSetNull).toHaveBeenCalled();
    cleanup();
    renderModal(textColumn, "hello");
    expect(screen.queryByRole("button", { name: "Set NULL" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Format" })).toBeNull();
  });
});
