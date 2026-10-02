import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { StructureColumn, TableInfo, TableStructure } from "../../../types/database";
import { useStructureDraftsStore } from "../../../stores/structure-drafts.store";
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
  // Staged drafts live in a global store, so each test starts clean
  useStructureDraftsStore.setState(useStructureDraftsStore.getInitialState());
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
      <StructurePanel connectionId="conn" database="app" activeTable={table} scopeKey={`conn::app::${table}`} />
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

  it("keeps staged column changes when switching tabs and tables", async () => {
    const user = userEvent.setup();
    const { switchTable } = renderPanel("orders");
    await user.type(await screen.findByDisplayValue("user_id"), "_2");
    await user.click(screen.getAllByRole("button", { name: /Add column/ })[0]);

    // Away to another tab and back
    await user.click(screen.getByRole("button", { name: "Indexes" }));
    await screen.findByText("No indexes");
    await user.click(screen.getByRole("button", { name: "Columns" }));
    expect(await screen.findByDisplayValue("user_id_2")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save changes \(2\)/ })).toBeTruthy();

    // Another table has its own, empty draft; coming back restores this one
    switchTable("users");
    expect(await screen.findByDisplayValue("email")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Save changes$/ })).toBeTruthy();
    switchTable("orders");
    expect(await screen.findByDisplayValue("user_id_2")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Save changes \(2\)/ })).toBeTruthy();
  });

  it("keeps a Key menu foreign key staged after switching tables, without adding it twice", async () => {
    const { switchTable } = renderPanel("orders");
    await openKeyMenuItem("user_id", /Add foreign key/);
    await screen.findByDisplayValue("orders_user_id_fkey");

    // Still on the Foreign Keys tab: the other table starts clean...
    switchTable("users");
    expect(await screen.findByText("No foreign keys")).toBeTruthy();
    expect(screen.queryByLabelText("Column")).toBeNull();

    // ...and coming back shows the same staged row
    switchTable("orders");
    expect(await screen.findAllByDisplayValue("orders_user_id_fkey")).toHaveLength(1);
  });

  it("keeps a Key menu index staged after leaving the tab, until it's discarded", async () => {
    const user = userEvent.setup();
    renderPanel("orders");
    await openKeyMenuItem("user_id", /^Add index/);
    await screen.findByDisplayValue("orders_user_id_idx");

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(await screen.findByRole("button", { name: "Indexes" }));
    expect(await screen.findAllByDisplayValue("orders_user_id_idx")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(await screen.findByRole("button", { name: "Indexes" }));
    expect(await screen.findByText("No indexes")).toBeTruthy();
  });
});
