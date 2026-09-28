import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { TableStructure } from "../../../types/database";
import { ColumnsTable } from "./ColumnsTable";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const structure: TableStructure = {
  dialect: "postgres",
  columns: ["id", "email", "name"].map((name) => ({
    name,
    dataType: "text",
    typeParams: null,
    isNullable: true,
    isPrimary: name === "id",
    isForeignKey: false,
    isIndexed: false,
    defaultValue: null,
  })),
};

// jsdom doesn't implement scrolling
const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "fetch_table_structure") return structure;
    throw new Error(`unexpected command ${cmd}`);
  });
});

afterEach(cleanup);

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ColumnsTable connectionId="conn" database="app" table="users" />
    </QueryClientProvider>,
  );
}

describe("ColumnsTable", () => {
  it("scrolls to and focuses the new column's name field on Add column", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByDisplayValue("email");
    expect(scrollIntoView).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Add column/ }));

    const nameInputs = screen.getAllByPlaceholderText("column_name");
    const newInput = nameInputs[nameInputs.length - 1];
    expect(newInput).toHaveProperty("value", "");
    expect(document.activeElement).toBe(newInput);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(newInput);

    // Each new column takes focus; earlier ones don't steal it back
    await user.click(screen.getByRole("button", { name: /Add column/ }));
    const after = screen.getAllByPlaceholderText("column_name");
    expect(document.activeElement).toBe(after[after.length - 1]);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
