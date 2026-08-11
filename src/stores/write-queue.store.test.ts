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
});
