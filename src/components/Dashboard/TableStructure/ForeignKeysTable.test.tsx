import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ForeignKey, StructureColumn, TableInfo, TableStructure } from "../../../types/database";
import { ForeignKeysTable, type ForeignKeySeed } from "./ForeignKeysTable";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function col(name: string, isNullable: boolean, isPrimary = false): StructureColumn {
  return { name, dataType: "int", typeParams: null, isNullable, isPrimary, isForeignKey: false, isIndexed: false, defaultValue: null };
}

const structures: Record<string, StructureColumn[]> = {
  orders: [col("id", false, true), col("user_id", true), col("owner_id", false), col("country", true), col("code", true)],
  users: [col("id", false, true), col("email", true)],
  // Composite primary key: no single column to default to
  regions: [col("country", false, true), col("code", false, true)],
};

const tables: TableInfo[] = [
  { name: "orders", tableType: "table", rowEstimate: null },
  { name: "users", tableType: "table", rowEstimate: null },
  { name: "regions", tableType: "table", rowEstimate: null },
  { name: "active_users", tableType: "view", rowEstimate: null },
];

const foreignKeys: ForeignKey[] = [
  {
    name: "orders_region_fkey",
    columns: ["country", "code"],
    referencedSchema: null,
    referencedTable: "regions",
    referencedColumns: ["country", "code"],
    onUpdate: "CASCADE",
    onDelete: "NO ACTION",
  },
];

let dialect: TableStructure["dialect"] = "postgres";
let currentForeignKeys = foreignKeys;
let applyError: string | null = null;

function renderTable(seed: ForeignKeySeed | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ForeignKeysTable connectionId="conn" database="app" table="orders" seed={seed} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  dialect = "postgres";
  currentForeignKeys = foreignKeys;
  applyError = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd, args) => {
    if (cmd === "fetch_table_foreign_keys") return currentForeignKeys;
    if (cmd === "fetch_table_structure") {
      const table = (args as { table: string }).table;
      return { dialect, columns: structures[table] ?? [] } satisfies TableStructure;
    }
    if (cmd === "list_tables") return tables;
    if (cmd === "apply_foreign_key_changes") {
      // Tauri rejects with the command's error string
      if (applyError) throw applyError;
      return [];
    }
    throw new Error(`unexpected command ${cmd}`);
  });
});

afterEach(cleanup);

describe("ForeignKeysTable", () => {
  it("lists existing foreign keys with their composite columns and actions", async () => {
    renderTable();
    expect(await screen.findByText("orders_region_fkey")).toBeTruthy();
    expect(screen.getByText("regions")).toBeTruthy();
    // country and code appear once on each side
    expect(screen.getAllByText("country")).toHaveLength(2);
    expect(screen.getAllByText("code")).toHaveLength(2);
    expect(screen.getByText("CASCADE")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Drop foreign key" })).toBeTruthy();
  });

  it("stages a drop with undo", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByRole("button", { name: "Drop foreign key" }));
    expect(screen.getByRole("button", { name: /Save changes \(1\)/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Undo/ }));
    expect(screen.getByRole("button", { name: /^Save changes$/ })).toBeTruthy();
  });

  it("pre-fills from the Columns tab seed, defaults to the foreign primary key, and saves", async () => {
    const user = userEvent.setup();
    renderTable({ column: "user_id" });

    expect(await screen.findByDisplayValue("orders_user_id_fkey")).toBeTruthy();
    const save = screen.getByRole("button", { name: /Save changes \(1\)/ }) as HTMLButtonElement;
    expect(screen.getByText(/needs a foreign table/)).toBeTruthy();
    expect(save.disabled).toBe(true);

    // Views can't be referenced
    const tableSelect = screen.getByLabelText("Foreign table") as HTMLSelectElement;
    expect([...tableSelect.options].map((o) => o.value)).not.toContain("active_users");

    await user.selectOptions(tableSelect, "users");
    const refColumn = screen.getByLabelText("Foreign column") as HTMLSelectElement;
    await vi.waitFor(() => expect(refColumn.value).toBe("id"));

    await user.selectOptions(screen.getByLabelText("On delete"), "CASCADE");
    await user.click(save);

    expect(invokeMock).toHaveBeenCalledWith("apply_foreign_key_changes", {
      connectionId: "conn",
      table: "orders",
      changes: {
        drops: [],
        adds: [
          {
            name: "orders_user_id_fkey",
            columns: ["user_id"],
            referencedTable: "users",
            referencedColumns: ["id"],
            onUpdate: "NO ACTION",
            onDelete: "CASCADE",
          },
        ],
      },
    });
  });

  it("renames the new foreign key with its column until the name is edited", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByRole("button", { name: /Add foreign key/ }));
    expect(screen.getByDisplayValue("orders_fkey")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Column"), "owner_id");
    const name = screen.getByDisplayValue("orders_owner_id_fkey");

    await user.type(name, "_custom");
    await user.selectOptions(screen.getByLabelText("Column"), "user_id");
    expect(screen.getByDisplayValue("orders_owner_id_fkey_custom")).toBeTruthy();
  });

  it("blocks SET NULL on a NOT NULL column", async () => {
    const user = userEvent.setup();
    renderTable({ column: "owner_id" });

    await user.selectOptions(await screen.findByLabelText("Foreign table"), "users");
    await vi.waitFor(() => expect((screen.getByLabelText("Foreign column") as HTMLSelectElement).value).toBe("id"));
    await user.selectOptions(screen.getByLabelText("On delete"), "SET NULL");

    expect(screen.getByText(/is NOT NULL, so foreign key "orders_owner_id_fkey" can't use SET NULL/)).toBeTruthy();
    const save = screen.getByRole("button", { name: /Save changes/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("offers no SET DEFAULT on MySQL", async () => {
    dialect = "mysql";
    renderTable({ column: "user_id" });

    const onDelete = (await screen.findByLabelText("On delete")) as HTMLSelectElement;
    expect([...onDelete.options].map((o) => o.value)).toEqual(["NO ACTION", "RESTRICT", "CASCADE", "SET NULL"]);
  });

  it("is read-only on SQLite", async () => {
    dialect = "sqlite";
    currentForeignKeys = [{ ...foreignKeys[0], name: null }];
    renderTable();

    expect(await screen.findByText("regions")).toBeTruthy();
    const add = screen.getByRole("button", { name: /Add foreign key/ }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Drop foreign key" })).toBeNull();
    // Toolbar hint + the row's lock
    expect(screen.getAllByLabelText(/SQLite can't change foreign keys/)).toHaveLength(2);
  });

  it("resets the foreign column when the foreign table changes", async () => {
    const user = userEvent.setup();
    renderTable({ column: "user_id" });

    await user.selectOptions(await screen.findByLabelText("Foreign table"), "users");
    const refColumn = screen.getByLabelText("Foreign column") as HTMLSelectElement;
    await vi.waitFor(() => expect(refColumn.value).toBe("id"));

    // regions has a composite primary key, so nothing is picked for the user
    await user.selectOptions(screen.getByLabelText("Foreign table"), "regions");
    await vi.waitFor(() =>
      expect([...refColumn.options].map((o) => o.value)).toEqual(["", "country", "code"]),
    );
    expect(refColumn.value).toBe("");
    expect(screen.getByText(/needs a foreign column/)).toBeTruthy();
  });

  it("warns about duplicate names among new foreign keys", async () => {
    const user = userEvent.setup();
    renderTable({ column: "user_id" });

    // Complete the first row so its own warning doesn't come first
    await user.selectOptions(await screen.findByLabelText("Foreign table"), "users");
    await vi.waitFor(() => expect((screen.getByLabelText("Foreign column") as HTMLSelectElement).value).toBe("id"));

    await user.click(screen.getByRole("button", { name: /Add foreign key/ }));
    const columnSelects = screen.getAllByLabelText("Column");
    await user.selectOptions(columnSelects[1], "user_id");

    expect(screen.getByText('A foreign key named "orders_user_id_fkey" already exists.')).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns on MySQL when a new foreign key reuses a name dropped in the same save", async () => {
    const user = userEvent.setup();
    dialect = "mysql";
    currentForeignKeys = [
      { ...foreignKeys[0], name: "orders_user_id_fkey", columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"] },
    ];
    // The "change ON DELETE" flow: drop, then re-add on the same column
    renderTable({ column: "user_id" });

    await user.click(await screen.findByRole("button", { name: "Drop foreign key" }));
    expect(screen.getByText(/MySQL can't reuse the name "orders_user_id_fkey" in the same save/)).toBeTruthy();

    // Renaming the new key clears it
    await user.type(screen.getByDisplayValue("orders_user_id_fkey"), "_v2");
    expect(screen.queryByText(/MySQL can't reuse/)).toBeNull();
  });

  it("shows the database error when a save fails and keeps the staged changes", async () => {
    const user = userEvent.setup();
    applyError = 'insert or update on table "orders" violates foreign key constraint';
    renderTable();

    await user.click(await screen.findByRole("button", { name: "Drop foreign key" }));
    await user.click(screen.getByRole("button", { name: /Save changes \(1\)/ }));

    expect(await screen.findByText(/violates foreign key constraint/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Undo/ })).toBeTruthy();
  });

  it("cancel discards staged drops and adds and clears a save error", async () => {
    const user = userEvent.setup();
    applyError = "boom";
    renderTable({ column: "user_id" });

    await user.click(await screen.findByRole("button", { name: "Drop foreign key" }));
    await user.selectOptions(screen.getByLabelText("Foreign table"), "users");
    await vi.waitFor(() => expect((screen.getByLabelText("Foreign column") as HTMLSelectElement).value).toBe("id"));
    await user.click(screen.getByRole("button", { name: /Save changes \(2\)/ }));
    expect(await screen.findByText("boom")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("boom")).toBeNull();
    expect(screen.queryByDisplayValue("orders_user_id_fkey")).toBeNull();
    expect(screen.getByRole("button", { name: "Drop foreign key" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Save changes$/ })).toBeTruthy();
  });
});
