import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { TableIndex, TableStructure } from "../../../types/database";
import { useStructureDraftsStore } from "../../../stores/structure-drafts.store";
import { IndexesTable, newPendingIndex } from "./IndexesTable";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const structure: TableStructure = {
  dialect: "mysql",
  columns: [
    { name: "id", dataType: "int", typeParams: null, isNullable: false, isPrimary: true, isForeignKey: false, isIndexed: false, defaultValue: null },
    { name: "email", dataType: "varchar", typeParams: "100", isNullable: true, isPrimary: false, isForeignKey: false, isIndexed: false, defaultValue: null },
    { name: "bio", dataType: "text", typeParams: null, isNullable: true, isPrimary: false, isForeignKey: false, isIndexed: false, defaultValue: null },
  ],
};

const indexes: TableIndex[] = [
  {
    name: "PRIMARY",
    columns: [{ name: "id", descending: false, isExpression: false, prefixLength: null }],
    isUnique: true,
    isPrimary: true,
    method: "BTREE",
    droppable: false,
  },
  {
    name: "users_email_idx",
    columns: [{ name: "email", descending: false, isExpression: false, prefixLength: null }],
    isUnique: false,
    isPrimary: false,
    method: "BTREE",
    droppable: true,
  },
];

const SCOPE_KEY = "conn::app::users";

/** `seed` stages a row the way the Columns tab's Key menu does */
function renderTable(seed: { column: string; unique: boolean } | null = null) {
  if (seed) {
    useStructureDraftsStore.getState().stageAdd("indexes", SCOPE_KEY, newPendingIndex("users", seed.column, seed.unique));
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IndexesTable connectionId="conn" database="app" table="users" scopeKey={SCOPE_KEY} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Staged drafts live in a global store, so each test starts clean
  useStructureDraftsStore.setState(useStructureDraftsStore.getInitialState());
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "fetch_table_indexes") return indexes;
    if (cmd === "fetch_table_structure") return structure;
    if (cmd === "apply_index_changes") return [];
    throw new Error(`unexpected command ${cmd}`);
  });
});

afterEach(cleanup);

describe("IndexesTable", () => {
  it("lists existing indexes and locks the primary key", async () => {
    renderTable();
    expect(await screen.findByText("users_email_idx")).toBeTruthy();
    expect(screen.getByText("PRIMARY")).toBeTruthy();
    expect(screen.getByText("PK")).toBeTruthy();
    expect(screen.getByLabelText("The primary key is read-only")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Drop index" })).toBeTruthy();
  });

  it("pre-fills a new index from the Columns tab seed and saves it", async () => {
    const user = userEvent.setup();
    renderTable({ column: "email", unique: true });

    const name = await screen.findByDisplayValue("users_email_key");
    expect(name).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Save changes \(1\)/ }));

    expect(invokeMock).toHaveBeenCalledWith("apply_index_changes", {
      connectionId: "conn",
      table: "users",
      changes: {
        drops: [],
        adds: [
          {
            name: "users_email_key",
            unique: true,
            columns: [{ name: "email", descending: false, prefixLength: null }],
          },
        ],
      },
    });
  });

  it("requires a prefix length for MySQL text columns before saving", async () => {
    const user = userEvent.setup();
    renderTable({ column: "bio", unique: false });

    await screen.findByDisplayValue("users_bio_idx");
    expect(screen.getByText(/needs a prefix length/)).toBeTruthy();
    const save = screen.getByRole("button", { name: /Save changes/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.type(screen.getByPlaceholderText("len"), "20");
    expect(screen.queryByText(/needs a prefix length/)).toBeNull();

    // Toggling DESC keeps the auto-generated name
    await user.click(screen.getByRole("button", { name: /click for descending/ }));
    await user.click(save);
    expect(invokeMock).toHaveBeenCalledWith(
      "apply_index_changes",
      expect.objectContaining({
        changes: {
          drops: [],
          adds: [{ name: "users_bio_idx", unique: false, columns: [{ name: "bio", descending: true, prefixLength: 20 }] }],
        },
      }),
    );
  });

  it("stages a drop with undo", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(await screen.findByRole("button", { name: "Drop index" }));
    expect(screen.getByRole("button", { name: /Save changes \(1\)/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Undo/ }));
    expect(screen.getByRole("button", { name: /^Save changes$/ })).toBeTruthy();
  });
});
