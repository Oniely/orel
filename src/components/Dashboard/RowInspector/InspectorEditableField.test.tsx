import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectorEditableField } from "./InspectorEditableField";

// The expanded editor pulls in Tauri-only modules and isn't used here
vi.mock("../shared/ValueEditorModal", () => ({ ValueEditorModal: () => null }));

afterEach(cleanup);

describe("InspectorEditableField date editing", () => {
  it("offers the date picker and Now for a date column and commits the picked text", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <InspectorEditableField
        table="events"
        column={{ name: "starts_on", dataType: "date", isNullable: true, isPrimary: false, hasDefault: false }}
        originalValue="2024-01-15"
        dirtyValue={undefined}
        isDirty={false}
        editable
        onCommit={onCommit}
      />,
    );
    fireEvent.doubleClick(screen.getByText('"2024-01-15"'));
    const input = screen.getByRole<HTMLInputElement>("textbox");
    expect(screen.getByRole("button", { name: "Pick date" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Now" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(input.value);
  });
});
