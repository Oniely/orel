import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "../../stores/connection.store";
import type { SavedConnection } from "../../types/connection";
import { ConnectionList } from "./ConnectionList";

const ROW_HEIGHT = 72;
const mutate = vi.fn();

vi.mock("../../hooks/useConnections", () => ({
  useReorderConnections: () => ({ mutate }),
}));
vi.mock("./ConnectionRow", () => ({
  default: ({ connection }: { connection: SavedConnection }) => <div>{connection.name}</div>,
}));

if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  }
  // @ts-expect-error jsdom doesn't ship PointerEvent; this is a test-only polyfill.
  window.PointerEvent = PointerEventPolyfill;
}

const conn = (id: string) => ({ id, name: id, type: "sqlite", host: id }) as SavedConnection;
const order = () => useConnectionStore.getState().savedConnections.map((c) => c.id);

beforeEach(() => {
  mutate.mockClear();
  useConnectionStore.setState({ savedConnections: ["a", "b", "c"].map(conn) });
  // jsdom has no layout: stack rows top-to-bottom in current DOM order.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.connectionId ? ROW_HEIGHT : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.dataset.connectionId) return 0;
      const rows = Array.from(this.parentElement?.querySelectorAll("[data-connection-id]") ?? []);
      return rows.indexOf(this) * ROW_HEIGHT;
    },
  });
});

afterEach(cleanup);

function drag(name: string, startY: number, moves: number[]) {
  const handle = document.querySelector(`[aria-label="Reorder ${name}"]`)!;
  fireEvent.pointerDown(handle, { button: 0, clientY: startY });
  for (const clientY of moves) act(() => void fireEvent.pointerMove(document, { clientY }));
  fireEvent.pointerUp(document);
}

describe("ConnectionList drag reorder", () => {
  it("moves a connection down and persists the new order", () => {
    render(<ConnectionList onEdit={vi.fn()} onDelete={vi.fn()} />);
    drag("a", 36, [36 + ROW_HEIGHT + 10]);
    expect(order()).toEqual(["b", "a", "c"]);
    expect(mutate).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("moves a connection up across several rows in one drag", () => {
    render(<ConnectionList onEdit={vi.fn()} onDelete={vi.fn()} />);
    drag("c", 180, [100, 20]);
    expect(order()).toEqual(["c", "a", "b"]);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("does not persist when the drag ends in the same slot", () => {
    render(<ConnectionList onEdit={vi.fn()} onDelete={vi.fn()} />);
    drag("b", 108, [120]);
    expect(order()).toEqual(["a", "b", "c"]);
    expect(mutate).not.toHaveBeenCalled();
  });
});
