import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardHotkeys } from "./useDashboardHotkeys";

const setPage = vi.fn();
const fakeState = {
  showInspector: false,
  selectedRowIndex: null,
  toggleSidebar: vi.fn(),
  showFilterBar: {},
  setShowFilterBar: vi.fn(),
  tableFilters: {},
  setFilters: vi.fn(),
  tablePagination: { scope: { page: 2, limit: 50 } },
  setPage,
};

vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos" }));
vi.mock("@heroui/react", () => ({ toast: { success: vi.fn() } }));
vi.mock("../../stores/dashboard.store", () => ({
  useDashboardStore: (select: (state: typeof fakeState) => unknown) => select(fakeState),
  DEFAULT_PAGINATION: { page: 1, limit: 50 },
  EMPTY_FILTER_STATE: { staged: [], applied: [] },
  DEFAULT_FILTER_ROW: [],
}));
vi.mock("../useTables", () => ({ useFetchRows: () => ({ data: { totalPages: 3 }, error: null }) }));
vi.mock("../useWriteQueueActions", () => ({ useWriteQueueActions: () => ({}) }));
vi.mock("./useDashboardCommands", () => ({ useDashboardCommands: () => ({}) }));
vi.mock("./useDashboardContext", () => ({
  useDashboardContext: () => ({
    connectionId: "c",
    activeDatabase: "db",
    openTabs: [],
    activeTabId: null,
    activeTableName: "users",
    scopeKey: "scope",
  }),
}));

function Harness() {
  useDashboardHotkeys();
  return (
    <>
      <input aria-label="input" />
      {/* Monaco (SQL editor, value modal) receives keystrokes through a hidden textarea. */}
      <textarea aria-label="textarea" />
    </>
  );
}

beforeEach(() => {
  setPage.mockClear();
  // react-hotkeys-hook maps "mod" to Meta only on a macOS user agent.
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDashboardHotkeys pagination", () => {
  it("pages with Cmd+Left/Right when no text field is focused", () => {
    render(<Harness />);
    fireEvent.keyDown(document.body, { key: "ArrowLeft", code: "ArrowLeft", metaKey: true });
    expect(setPage).toHaveBeenLastCalledWith("scope", 1);
    fireEvent.keyDown(document.body, { key: "ArrowRight", code: "ArrowRight", metaKey: true });
    expect(setPage).toHaveBeenLastCalledWith("scope", 3);
  });

  it.each(["input", "textarea"])(
    "leaves Cmd+Left/Right to native line navigation inside %s",
    (label) => {
      render(<Harness />);
      const el = screen.getByLabelText(label);
      el.focus();
      for (const key of ["ArrowLeft", "ArrowRight"]) {
        const notCancelled = fireEvent.keyDown(el, { key, code: key, metaKey: true });
        expect(notCancelled).toBe(true);
      }
      expect(setPage).not.toHaveBeenCalled();
    },
  );
});
