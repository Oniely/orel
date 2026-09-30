import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { TableStructure } from "../../../types/database";
import { ColumnsTable, type ColumnsTableProps } from "./ColumnsTable";

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

let dialect: TableStructure["dialect"] = "postgres";

// jsdom doesn't implement scrolling
const scrollIntoView = vi.fn();

beforeEach(() => {
  dialect = "postgres";
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "fetch_table_structure") return { ...structure, dialect };
    throw new Error(`unexpected command ${cmd}`);
  });
});

afterEach(cleanup);

function renderTable(props: Pick<ColumnsTableProps, "onAddIndex" | "onAddForeignKey"> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ColumnsTable connectionId="conn" database="app" table="users" {...props} />
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

  it("opens the Foreign Keys tab from the Key menu", async () => {
    const user = userEvent.setup();
    const onAddForeignKey = vi.fn();
    renderTable({ onAddIndex: vi.fn(), onAddForeignKey });

    await user.click(await screen.findByRole("button", { name: /Key options for email/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Add foreign key/ }));
    expect(onAddForeignKey).toHaveBeenCalledWith("email");
  });

  it("opens the Indexes tab from the Key menu", async () => {
    const user = userEvent.setup();
    const onAddIndex = vi.fn();
    renderTable({ onAddIndex, onAddForeignKey: vi.fn() });

    await user.click(await screen.findByRole("button", { name: /Key options for email/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Add unique index/ }));
    expect(onAddIndex).toHaveBeenCalledWith("email", true);
  });

  it("disables only Add foreign key on SQLite and says why", async () => {
    const user = userEvent.setup();
    dialect = "sqlite";
    const onAddForeignKey = vi.fn();
    renderTable({ onAddIndex: vi.fn(), onAddForeignKey });

    await user.click(await screen.findByRole("button", { name: /Key options for email/ }));
    const addForeignKey = await screen.findByRole("menuitem", { name: /Add foreign key/ });
    expect(addForeignKey.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /^Add index/ }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByText(/SQLite can't change foreign keys/)).toBeTruthy();

    await user.click(addForeignKey);
    expect(onAddForeignKey).not.toHaveBeenCalled();
  });

  it("locks the whole Key menu while column changes are unsaved", async () => {
    const user = userEvent.setup();
    renderTable({ onAddIndex: vi.fn(), onAddForeignKey: vi.fn() });

    // Leaving for another tab would discard this edit
    await user.type(await screen.findByDisplayValue("email"), "_2");
    await user.click(screen.getByRole("button", { name: /Key options for email/ }));

    for (const name of [/^Add index/, /Add unique index/, /Add foreign key/]) {
      expect((await screen.findByRole("menuitem", { name })).getAttribute("aria-disabled")).toBe("true");
    }
    // One reason row, not one per item
    expect(screen.getAllByText("Save or cancel column changes first")).toHaveLength(1);
  });
});
