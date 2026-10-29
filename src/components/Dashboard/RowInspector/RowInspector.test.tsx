import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "../../../types/database";
import { RowInspector } from "./RowInspector";

function col(name: string, isPrimary = false): ColumnInfo {
  return { name, dataType: "text", isNullable: true, isPrimary, hasDefault: false };
}

const columns = [col("id", true), col("email"), col("first_name"), col("last_name")];
const rows = [{ id: 1, email: "a@example.com", first_name: "Ada", last_name: "Lovelace" }];

vi.mock("../../../stores/dashboard.store", () => ({
  useDashboardStore: (select: (state: unknown) => unknown) =>
    select({ selectedRowIndex: 0, setSelectedRowIndex: vi.fn(), setShowInspector: vi.fn() }),
}));
vi.mock("../../../hooks/dashboard/useDashboardContext", () => ({
  useDashboardContext: () => ({ activeTableName: "users" }),
}));
vi.mock("../../../hooks/dashboard/useActiveTable", () => ({
  useActiveTable: () => ({
    rows,
    columns,
    writeQueue: { scopeKey: "scope", hasPrimaryKey: true, isApplyingRow: false },
  }),
}));
// Field rendering is covered elsewhere; only the column list matters here
vi.mock("./InspectorEditableField", () => ({ InspectorEditableField: () => null }));

afterEach(cleanup);

const shownColumns = () => screen.queryAllByText(/:$/).map((el) => el.textContent?.replace(/:$/, ""));
const openSearch = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Toggle column search" }));
  return screen.getByRole("searchbox", { name: "Search columns" });
};

describe("RowInspector column search", () => {
  it("is hidden by default and opens via the header toggle", () => {
    render(<RowInspector />);
    expect(screen.queryByRole("searchbox", { name: "Search columns" })).toBeNull();
  });

  it("filters columns by name, case-insensitively", async () => {
    render(<RowInspector />);
    expect(shownColumns()).toEqual(["id", "email", "first_name", "last_name"]);

    const input = await openSearch();
    await userEvent.type(input, "NAME");

    expect(shownColumns()).toEqual(["first_name", "last_name"]);
    expect(screen.getByText("2/4 columns")).toBeTruthy();
  });

  it("shows every column again once the search is cleared", async () => {
    render(<RowInspector />);
    const input = await openSearch();
    await userEvent.type(input, "email");
    expect(shownColumns()).toEqual(["email"]);

    await userEvent.clear(input);
    expect(shownColumns()).toEqual(["id", "email", "first_name", "last_name"]);
    expect(screen.getByText("4 columns")).toBeTruthy();
  });

  it("stops filtering (but keeps the typed term) when toggled closed", async () => {
    render(<RowInspector />);
    const toggle = screen.getByRole("button", { name: "Toggle column search" });
    const input = await openSearch();
    await userEvent.type(input, "email");
    expect(shownColumns()).toEqual(["email"]);

    await userEvent.click(toggle);
    expect(screen.queryByRole("searchbox", { name: "Search columns" })).toBeNull();
    expect(shownColumns()).toEqual(["id", "email", "first_name", "last_name"]);

    await userEvent.click(toggle);
    const reopened = screen.getByRole("searchbox", { name: "Search columns" }) as HTMLInputElement;
    expect(reopened.value).toBe("email");
    expect(shownColumns()).toEqual(["email"]);
  });
});

describe("RowInspector column labels", () => {
  it("uses the foreground color, not the type color, so labels stand apart from values", () => {
    render(<RowInspector />);
    const label = screen.getByText("email:");
    expect(label.className).toContain("text-foreground");
    expect(label.style.color).toBe("");
  });
});
