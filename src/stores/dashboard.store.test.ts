import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlEditorState } from "../types/editor";
import { createDashboardStore, getActiveEditorIds } from "./dashboard.store";

describe("dashboard store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps tabs isolated by connection and database", () => {
    const store = createDashboardStore();

    store.getState().openTable("connection-a::main", "users");
    store.getState().openTable("connection-b::main", "orders");

    expect(store.getState().tabState["connection-a::main"]).toMatchObject({
      activeTabId: "t-users",
      tabs: [{ id: "t-users", type: "table", label: "users" }],
    });
    expect(store.getState().tabState["connection-b::main"]).toMatchObject({
      activeTabId: "t-orders",
      tabs: [{ id: "t-orders", type: "table", label: "orders" }],
    });
  });

  it("opens an existing table instead of duplicating it", () => {
    const store = createDashboardStore();

    store.getState().openTable("connection::main", "users");
    store.getState().openTable("connection::main", "orders");
    store.getState().openTable("connection::main", "users");

    expect(store.getState().tabState["connection::main"].tabs).toHaveLength(2);
    expect(store.getState().tabState["connection::main"].activeTabId).toBe("t-users");
  });

  it("stores SQL and editor state only on query tabs", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    const store = createDashboardStore();
    const databaseKey = "connection::main";
    store.getState().openQuery(databaseKey);
    store.getState().updateSql(databaseKey, "q-42", "select 1");
    store.getState().updateEditorState(databaseKey, "q-42", {
      ...createSqlEditorState(),
      mode: "manual",
      transactionState: "active",
    });

    expect(store.getState().tabState[databaseKey].tabs[0]).toEqual({
      id: "q-42",
      type: "query",
      label: "Query 1",
      sql: "select 1",
      editorState: {
        ...createSqlEditorState(),
        mode: "manual",
        transactionState: "active",
      },
    });
  });

  it("selects the previous tab when the active tab closes", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    const store = createDashboardStore();
    const databaseKey = "connection::main";
    store.getState().openTable(databaseKey, "users");
    store.getState().openQuery(databaseKey);
    store.getState().setSelectedRowIndex(3);

    store.getState().closeTab(databaseKey, "q-42");

    expect(store.getState().tabState[databaseKey].activeTabId).toBe("t-users");
    expect(store.getState().selectedRowIndex).toBeNull();
  });

  it("marks guarded editor transactions inactive across database scopes", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1).mockReturnValueOnce(2);
    const store = createDashboardStore();
    store.getState().openQuery("connection::main");
    store.getState().openQuery("connection::analytics");
    store.getState().updateEditorState("connection::main", "q-1", {
      ...createSqlEditorState(),
      transactionState: "active",
    });
    store.getState().updateEditorState("connection::analytics", "q-2", {
      ...createSqlEditorState(),
      transactionState: "failed",
    });

    store.getState().markEditorTransactionInactive("q-2");

    const mainTab = store.getState().tabState["connection::main"].tabs[0];
    const analyticsTab = store.getState().tabState["connection::analytics"].tabs[0];
    expect(mainTab.type === "query" && mainTab.editorState.transactionState).toBe("active");
    expect(analyticsTab.type === "query" && analyticsTab.editorState.transactionState).toBe(
      "inactive",
    );
  });

  it("collects active and failed transactions only from requested database scopes", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1).mockReturnValueOnce(2);
    const store = createDashboardStore();
    store.getState().openQuery("connection::main");
    store.getState().openQuery("connection::analytics");
    store.getState().updateEditorState("connection::main", "q-1", {
      ...createSqlEditorState(),
      transactionState: "active",
    });
    store.getState().updateEditorState("connection::analytics", "q-2", {
      ...createSqlEditorState(),
      transactionState: "failed",
    });

    expect(getActiveEditorIds(store.getState(), ["connection::main"])).toEqual(["q-1"]);
    expect(
      getActiveEditorIds(store.getState(), [
        "connection::main",
        "connection::analytics",
      ]),
    ).toEqual(["q-1", "q-2"]);
  });

  it("creates independent state for each dashboard mount", () => {
    const firstMount = createDashboardStore();
    firstMount.getState().openTable("connection::main", "users");

    const secondMount = createDashboardStore();

    expect(secondMount.getState().tabState).toEqual({});
    expect(secondMount.getState().sidebarOpen).toBe(true);
    expect(secondMount.getState().showInspector).toBe(false);
  });
});

