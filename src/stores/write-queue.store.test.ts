import { beforeEach, describe, expect, it } from "vitest";
import { useWriteQueueStore } from "./write-queue.store";

describe("write queue store", () => {
  beforeEach(() => {
    useWriteQueueStore.getState().clearAll();
  });

  it("shares recently saved cell state between dashboard consumers", () => {
    const scope = "connection::database::users";
    useWriteQueueStore.getState().markRecentlySaved(scope, [["row-1", ["name"]]]);

    expect(useWriteQueueStore.getState().recentlySaved[scope].get("row-1")).toEqual([
      "name",
    ]);

    useWriteQueueStore.getState().clearRecentlySavedRow(scope, "row-1");
    expect(useWriteQueueStore.getState().recentlySaved[scope]).toBeUndefined();
  });

  it("keeps changes isolated by table scope", () => {
    const identity = { pkColumns: ["id"], pkValues: [1] };
    useWriteQueueStore
      .getState()
      .stageUpdate("connection::database::users", identity, [
        { column: "name", oldValue: "before", newValue: "after" },
      ]);

    expect(
      useWriteQueueStore.getState().getChangeCount("connection::database::users"),
    ).toBe(1);
    expect(
      useWriteQueueStore.getState().getChangeCount("connection::database::orders"),
    ).toBe(0);
  });

  it("marks a row as deleted and reflects in change count", () => {
    const scope = "connection::database::users";
    const identity = { pkColumns: ["id"], pkValues: [1] };
    useWriteQueueStore.getState().stageDelete(scope, identity);

    expect(useWriteQueueStore.getState().getChangeCount(scope)).toBe(1);
    expect(useWriteQueueStore.getState().getRowChangeKind(scope, identity)).toBe("Delete");
  });

  it("undoes a delete by unstaging the row", () => {
    const scope = "connection::database::users";
    const identity = { pkColumns: ["id"], pkValues: [1] };
    useWriteQueueStore.getState().stageDelete(scope, identity);
    useWriteQueueStore.getState().unstageRow(scope, identity);

    expect(useWriteQueueStore.getState().getChangeCount(scope)).toBe(0);
    expect(useWriteQueueStore.getState().getRowChangeKind(scope, identity)).toBeNull();
  });

  it("stages an insert and includes it in change count", () => {
    const scope = "connection::database::users";
    useWriteQueueStore.getState().stageInsert(scope, { name: "Alice", age: 30 });

    expect(useWriteQueueStore.getState().getChangeCount(scope)).toBe(1);
    expect(useWriteQueueStore.getState().getInserts(scope)).toHaveLength(1);
  });

  it("clears all changes for a specific table scope without affecting others", () => {
    const users = "connection::database::users";
    const orders = "connection::database::orders";
    const identity = { pkColumns: ["id"], pkValues: [1] };
    useWriteQueueStore.getState().stageDelete(users, identity);
    useWriteQueueStore.getState().stageInsert(orders, { total: 100 });

    useWriteQueueStore.getState().clearTable(users);

    expect(useWriteQueueStore.getState().getChangeCount(users)).toBe(0);
    expect(useWriteQueueStore.getState().getChangeCount(orders)).toBe(1);
  });
});
