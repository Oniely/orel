import { describe, expect, it } from "vitest";
import { nextTableSelection } from "./tableSelection";

const order = ["a", "b", "c", "d"];
const click = (name: string, mods: { toggle?: boolean; range?: boolean } = {}) => ({
  name,
  toggle: mods.toggle ?? false,
  range: mods.range ?? false,
});

describe("nextTableSelection", () => {
  it("plain click selects only the clicked table", () => {
    expect(nextTableSelection({ selected: ["a", "b"], anchor: "a" }, click("c"), order)).toEqual({
      selected: ["c"],
      anchor: "c",
    });
  });

  it("mod-click adds and removes tables", () => {
    const added = nextTableSelection({ selected: ["a"], anchor: "a" }, click("c", { toggle: true }), order);
    expect(added.selected).toEqual(["a", "c"]);
    const removed = nextTableSelection(added, click("a", { toggle: true }), order);
    expect(removed.selected).toEqual(["c"]);
  });

  it("shift-click selects the range from the anchor in either direction", () => {
    expect(nextTableSelection({ selected: ["b"], anchor: "b" }, click("d", { range: true }), order).selected).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(nextTableSelection({ selected: ["c"], anchor: "c" }, click("a", { range: true }), order).selected).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("shift-click without a visible anchor acts like a plain click", () => {
    expect(nextTableSelection({ selected: [], anchor: "gone" }, click("b", { range: true }), order)).toEqual({
      selected: ["b"],
      anchor: "b",
    });
  });
});
