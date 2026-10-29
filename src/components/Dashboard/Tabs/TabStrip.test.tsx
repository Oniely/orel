import { useSyncExternalStore } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabStrip } from "./TabStrip";

const TAB_WIDTH = 100;

interface HarnessTab {
  id: string;
  label: string;
  type: "table";
}

const harness = vi.hoisted(() => {
  const initial: HarnessTab[] = [
    { id: "a", label: "a", type: "table" },
    { id: "b", label: "b", type: "table" },
    { id: "c", label: "c", type: "table" },
    { id: "d", label: "d", type: "table" },
  ];
  let tabs = initial;
  const activeTabId: string | null = "a";
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  let snapshot = { openTabs: tabs, activeTabId };

  const moveTab = vi.fn((id: string, targetId: string) => {
    const from = tabs.findIndex((t) => t.id === id);
    const to = tabs.findIndex((t) => t.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const next = [...tabs];
    next.splice(from, 1);
    next.splice(to, 0, tabs[from]);
    tabs = next;
    snapshot = { openTabs: tabs, activeTabId };
    notify();
  });
  const activateTab = vi.fn();

  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    moveTab,
    activateTab,
    order: () => tabs.map((t) => t.id),
    reset: () => {
      tabs = initial.map((t) => ({ ...t }));
      snapshot = { openTabs: tabs, activeTabId };
      moveTab.mockClear();
      activateTab.mockClear();
    },
  };
});

vi.mock("../../../stores/dashboard.store", () => ({
  useDashboardStore: () => false,
}));
vi.mock("../../../hooks/dashboard/useDashboardContext", () => ({
  useDashboardContext: () => useSyncExternalStore(harness.subscribe, harness.getSnapshot),
}));
vi.mock("../../../hooks/dashboard/useDashboardCommands", () => ({
  useDashboardCommands: () => ({
    activateTab: harness.activateTab,
    moveTab: harness.moveTab,
    closeTab: vi.fn(),
    openQuery: vi.fn(),
  }),
}));

// Stand in for the real flex layout: every tab is TAB_WIDTH wide, laid out left-to-right
// in current DOM order, so offsetLeft reflects whatever order the strip is in right now
// (jsdom itself never computes real layout).
beforeEach(() => {
  harness.reset();
  Element.prototype.scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.dataset.tabId) return 0;
      const siblings = Array.from(this.parentElement?.querySelectorAll("[data-tab-id]") ?? []);
      return siblings.indexOf(this) * TAB_WIDTH;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.tabId ? TAB_WIDTH : 0;
    },
  });
});

afterEach(cleanup);

// jsdom has no PointerEvent constructor, so @testing-library's fireEvent.pointerX
// helpers fall back to a bare Event with clientX/button left undefined. Polyfill it
// with a thin MouseEvent subclass so drag math gets real coordinates in tests.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  }
  // @ts-expect-error jsdom doesn't ship PointerEvent; this is a test-only polyfill.
  window.PointerEvent = PointerEventPolyfill;
}

function dragTo(id: string, startClientX: number, moves: number[]) {
  const el = document.querySelector(`[data-tab-id="${id}"]`)!;
  fireEvent.pointerDown(el, { button: 0, clientX: startClientX });
  for (const clientX of moves) {
    fireEvent.pointerMove(document, { clientX });
  }
  fireEvent.pointerUp(document);
}

describe("TabStrip drag reorder (DOM)", () => {
  it("moves a tab one slot to the right on a single-step drag", () => {
    render(<TabStrip />);
    // 'a' sits centered at x=50; move the pointer past 'b's center (150).
    dragTo("a", 50, [160]);
    expect(harness.order()).toEqual(["b", "a", "c", "d"]);
    expect(harness.moveTab).toHaveBeenCalledTimes(1);
  });

  it("moves a tab one slot to the left on a single-step drag", () => {
    render(<TabStrip />);
    // 'c' sits centered at x=250; move left past 'b's center (150).
    dragTo("c", 250, [140]);
    expect(harness.order()).toEqual(["a", "c", "b", "d"]);
    expect(harness.moveTab).toHaveBeenCalledTimes(1);
  });

  it("lands in the correct final slot on a fast, far drag without flinging siblings", () => {
    render(<TabStrip />);
    // Drag 'a' (center 50) all the way past 'd' (center 350) in one jump.
    dragTo("a", 50, [400]);
    expect(harness.order()).toEqual(["b", "c", "d", "a"]);
    // One decisive move, not a cascade of swaps through every slot it crossed.
    expect(harness.moveTab).toHaveBeenCalledTimes(1);
  });

  it("walks through incremental moves and ends at a stable, correctly-ordered result", () => {
    render(<TabStrip />);
    dragTo("a", 50, [160, 260, 260, 260]);
    expect(harness.order()).toEqual(["b", "c", "a", "d"]);
  });

  it("does not reorder again when the pointer holds still after a move", () => {
    render(<TabStrip />);
    dragTo("a", 50, [160, 160, 160, 160, 160]);
    expect(harness.order()).toEqual(["b", "a", "c", "d"]);
    expect(harness.moveTab).toHaveBeenCalledTimes(1);
  });

  it("never moves a tab that wasn't dragged", () => {
    render(<TabStrip />);
    dragTo("b", 150, [360]);
    for (const call of harness.moveTab.mock.calls) {
      expect(call[0]).toBe("b");
    }
  });

  it("suppresses the trailing click's tab activation after a real drag", () => {
    render(<TabStrip />);
    dragTo("a", 50, [160]);
    const el = document.querySelector('[data-tab-id="a"]')!;
    fireEvent.click(el);
    expect(harness.activateTab).not.toHaveBeenCalled();
  });
});
