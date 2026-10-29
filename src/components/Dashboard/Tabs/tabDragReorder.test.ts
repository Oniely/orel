import { describe, expect, it } from "vitest";
import { computeDragReorderTarget, type TabSlot } from "./tabDragReorder";

// Three equal-width tabs resting at [0-100), [100-200), [200-300).
const evenSlots: TabSlot[] = [
  { id: "a", left: 0, width: 100 },
  { id: "b", left: 100, width: 100 },
  { id: "c", left: 200, width: 100 },
];

// Variable-width tabs, as real labels produce: a is wide, b and c are narrow.
const unevenSlots: TabSlot[] = [
  { id: "a", left: 0, width: 220 }, // center 110
  { id: "b", left: 220, width: 60 }, // center 250
  { id: "c", left: 280, width: 60 }, // center 310
];

describe("computeDragReorderTarget", () => {
  it("returns null while the dragged tab's center is still over its own slot", () => {
    expect(computeDragReorderTarget(evenSlots, "a", 10)).toBeNull();
    expect(computeDragReorderTarget(evenSlots, "a", 99)).toBeNull();
  });

  it("targets the next tab once the center crosses past its center", () => {
    expect(computeDragReorderTarget(evenSlots, "a", 151)).toBe("b");
  });

  it("targets the previous tab when dragged left past its center", () => {
    expect(computeDragReorderTarget(evenSlots, "c", 149)).toBe("b");
  });

  it("jumps straight to the final slot on a fast multi-tab drag", () => {
    expect(computeDragReorderTarget(evenSlots, "a", 251)).toBe("c");
  });

  it("clamps to the last slot when dragged past the end of the strip", () => {
    expect(computeDragReorderTarget(evenSlots, "a", 10_000)).toBe("c");
  });

  it("clamps to the first slot when dragged before the start of the strip", () => {
    expect(computeDragReorderTarget(evenSlots, "c", -10_000)).toBe("a");
  });

  it("never targets the dragged tab's own slot", () => {
    expect(computeDragReorderTarget(evenSlots, "c", 250)).toBeNull();
  });

  it("returns null for an id that isn't in the slot list", () => {
    expect(computeDragReorderTarget(evenSlots, "missing", 50)).toBeNull();
  });

  it("accounts for uneven tab widths instead of assuming a fixed grid", () => {
    // Must pass each neighbor's actual center, not just cross into its box, before
    // a reorder triggers against it.
    expect(computeDragReorderTarget(unevenSlots, "a", 260)).toBe("b");
    expect(computeDragReorderTarget(unevenSlots, "a", 320)).toBe("c");
  });

  it("is stable across repeated calls with the same inputs (no oscillation)", () => {
    const results = Array.from({ length: 5 }, () => computeDragReorderTarget(evenSlots, "a", 151));
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("b");
  });

  it("matches the store's moveTab(dragged, target) splice semantics end-to-end", () => {
    // Mirrors dashboard.store.test.ts's "moves a tab to another tab's position" case:
    // moveTab removes the dragged id, then re-inserts it at the target's original index.
    const moveTab = (order: string[], draggedId: string, targetId: string) => {
      const next = [...order];
      const from = next.indexOf(draggedId);
      const to = next.indexOf(targetId);
      next.splice(from, 1);
      next.splice(to, 0, draggedId);
      return next;
    };

    let order = ["a", "b", "c"];
    let slots: TabSlot[] = order.map((id, i) => ({ id, left: i * 100, width: 100 }));

    // Drag 'c' far enough left that its center lands over 'a's slot.
    let target = computeDragReorderTarget(slots, "c", 10);
    expect(target).toBe("a");
    order = moveTab(order, "c", target!);
    expect(order).toEqual(["c", "a", "b"]);

    // Re-measure after the reorder, then drag 'c' back toward the end, past 'b'.
    slots = order.map((id, i) => ({ id, left: i * 100, width: 100 }));
    target = computeDragReorderTarget(slots, "c", 290);
    expect(target).toBe("b");
    order = moveTab(order, "c", target!);
    expect(order).toEqual(["a", "b", "c"]);
  });
});
