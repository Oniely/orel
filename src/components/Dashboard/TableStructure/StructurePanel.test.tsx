import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { StructureColumn, TableInfo, TableStructure } from "../../../types/database";
import { StructurePanel } from "./StructurePanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// The DDL tab's Monaco editor isn't needed here
vi.mock("./DDL", () => ({ DDL: () => null }));

const invokeMock = vi.mocked(invoke);

function col(name: string, isPrimary = false): StructureColumn {
  return { name, dataType: "int", typeParams: null, isNullable: true, isPrimary, isForeignKey: false, isIndexed: false, defaultValue: null };
}

const structures: Record<string, StructureColumn[]> = {
  orders: [col("id", true), col("user_id")],
  users: [col("id", true), col("email")],
};

const tables: TableInfo[] = [
  { name: "orders", tableType: "table", rowEstimate: null },
  { name: "users", tableType: "table", rowEstimate: null },
];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  invokeMock.mockImplementation(async (cmd, args) => {
    const table = (args as { table?: string } | undefined)?.table ?? "";
    if (cmd === "fetch_table_structure") {
      return { dialect: "postgres", columns: structures[table] ?? [] } satisfies TableStructure;
    }
    if (cmd === "fetch_table_foreign_keys" || cmd === "fetch_table_indexes") return [];
    if (cmd === "list_tables") return tables;
    throw new Error(`unexpected command ${cmd}`);
  });
});

afterEach(cleanup);

function renderPanel(activeTable: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (table: string) => (
    <QueryClientProvider client={client}>
      <StructurePanel connectionId="conn" database="app" activeTable={table} />
    </QueryClientProvider>
  );
  const result = render(ui(activeTable));
  return { ...result, switchTable: (table: string) => result.rerender(ui(table)) };
}

async function openKeyMenuItem(column: string, item: RegExp) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: new RegExp(`Key options for ${column}`) }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

describe("StructurePanel", () => {
  it("jumps from the Columns tab's Key menu to a pre-filled foreign key", async () => {
    renderPanel("orders");
    await openKeyMenuItem("user_id", /Add foreign key/);

    expect(await screen.findByDisplayValue("orders_user_id_fkey")).toBeTruthy();
    expect((screen.getByLabelText("Column") as HTMLSelectElement).value).toBe("user_id");
  });

  it("doesn't bring a seeded foreign key back after switching tables", async () => {
    const { switchTable } = renderPanel("orders");
    await openKeyMenuItem("user_id", /Add foreign key/);
    await screen.findByDisplayValue("orders_user_id_fkey");

    // Still on the Foreign Keys tab: the other table starts clean...
    switchTable("users");
    expect(await screen.findByText("No foreign keys")).toBeTruthy();
    expect(screen.queryByLabelText("Column")).toBeNull();

    // ...and coming back doesn't re-add the seeded row
    switchTable("orders");
    expect(await screen.findByText("No foreign keys")).toBeTruthy();
    expect(screen.queryByDisplayValue("orders_user_id_fkey")).toBeNull();
  });

  it("doesn't bring a seeded index back after switching tables", async () => {
    const { switchTable } = renderPanel("orders");
    await openKeyMenuItem("user_id", /^Add index/);
    expect(await screen.findByDisplayValue("orders_user_id_idx")).toBeTruthy();

    switchTable("users");
    expect(await screen.findByText("No indexes")).toBeTruthy();
    switchTable("orders");
    expect(await screen.findByText("No indexes")).toBeTruthy();
    expect(screen.queryByDisplayValue("orders_user_id_idx")).toBeNull();
  });

  it("drops the seed when leaving the tab through the tab bar", async () => {
    const user = userEvent.setup();
    renderPanel("orders");
    await openKeyMenuItem("user_id", /Add foreign key/);
    await screen.findByDisplayValue("orders_user_id_fkey");

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(await screen.findByRole("button", { name: "Foreign Keys" }));
    expect(await screen.findByText("No foreign keys")).toBeTruthy();
  });
});
