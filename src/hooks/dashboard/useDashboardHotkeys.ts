import { useHotkeys, type Options as HotkeyOptions } from "react-hotkeys-hook";
import { toast } from "@heroui/react";
import { useShallow } from "zustand/react/shallow";
import { platform, type Platform } from "@tauri-apps/plugin-os";
import { useFetchRows } from "../useTables";
import { useWriteQueueActions } from "../useWriteQueueActions";
import {
  useDashboardStore,
  DEFAULT_PAGINATION,
  EMPTY_FILTER_STATE,
  DEFAULT_FILTER_ROW,
} from "../../stores/dashboard.store";
import { useDashboardCommands } from "./useDashboardCommands";
import { useDashboardContext } from "./useDashboardContext";

const os: Platform = platform();

export function usePlatform() {
  return os;
}

const APP_HOTKEY_OPTIONS: HotkeyOptions = {
  preventDefault: true,
  enableOnFormTags: true,
  enableOnContentEditable: true,
  eventListenerOptions: { capture: true },
};

export function useDashboardHotkeys() {
  const { connectionId, activeDatabase, openTabs, activeTabId, activeTableName, scopeKey } = useDashboardContext();
  const {
    showInspector,
    selectedRowIndex,
    toggleSidebar,
    showFilterBar,
    setShowFilterBar,
    filters,
    setFilters,
    appliedFilters,
    pagination,
    setPage,
  } = useDashboardStore(
    useShallow((s) => ({
      showInspector: s.showInspector,
      selectedRowIndex: s.selectedRowIndex,
      toggleSidebar: s.toggleSidebar,
      showFilterBar: !!s.showFilterBar[scopeKey ?? ""],
      setShowFilterBar: s.setShowFilterBar,
      filters: (s.tableFilters[scopeKey ?? ""] ?? EMPTY_FILTER_STATE).staged,
      setFilters: s.setFilters,
      appliedFilters: (s.tableFilters[scopeKey ?? ""] ?? EMPTY_FILTER_STATE).applied,
      pagination: s.tablePagination[scopeKey ?? ""] ?? DEFAULT_PAGINATION,
      setPage: s.setPage,
    })),
  );
  const commands = useDashboardCommands();
  const { data: queryResult = null, error } = useFetchRows(
    connectionId,
    activeDatabase,
    activeTableName,
    pagination.limit,
    pagination.page,
    appliedFilters,
  );
  const writeQueue = useWriteQueueActions(
    scopeKey,
    connectionId,
    activeDatabase,
    activeTableName,
    error ? null : queryResult,
  );

  useHotkeys(
    "mod+1,mod+2,mod+3,mod+4,mod+5,mod+6,mod+7,mod+8,mod+9",
    (event) => {
      event.stopPropagation();
      const tab = openTabs[Number(event.code.slice(-1)) - 1];
      if (tab) commands.activateTab(tab.id);
    },
    APP_HOTKEY_OPTIONS,
    [openTabs, commands.activateTab],
  );
  useHotkeys(
    "mod+t",
    (event) => {
      event.stopPropagation();
      if (!event.repeat) commands.openQuery();
    },
    APP_HOTKEY_OPTIONS,
    [commands.openQuery],
  );
  useHotkeys(
    "mod+w",
    (event) => {
      event.stopPropagation();
      if (!event.repeat && activeTabId) commands.closeTab(activeTabId);
    },
    APP_HOTKEY_OPTIONS,
    [activeTabId, commands.closeTab],
  );
  useHotkeys("ctrl+tab", () => commands.cycleTab(1), [commands.cycleTab]);
  useHotkeys("ctrl+shift+tab", () => commands.cycleTab(-1), [commands.cycleTab]);
  useHotkeys("alt+z", toggleSidebar, [toggleSidebar]);
  useHotkeys(
    "mod+r",
    (event) => {
      event.stopPropagation();
      commands.refresh();
    },
    APP_HOTKEY_OPTIONS,
    [commands.refresh],
  );
  useHotkeys(
    "mod+s",
    (event) => {
      event.stopPropagation();
      if (showInspector && selectedRowIndex !== null) {
        void writeQueue.handleApplyRow(selectedRowIndex).then((applied) => {
          if (applied) toast.success("Row saved");
        });
      } else {
        void writeQueue.handleApply();
      }
    },
    APP_HOTKEY_OPTIONS,
    [writeQueue, showInspector, selectedRowIndex],
  );
  useHotkeys(
    "mod+shift+s",
    (event) => {
      event.stopPropagation();
      writeQueue.handleCopySql();
    },
    APP_HOTKEY_OPTIONS,
    [writeQueue],
  );
  useHotkeys(
    "mod+f",
    (event) => {
      event.stopPropagation();
      if (!showFilterBar) {
        if (filters.length === 0) {
          setFilters(scopeKey, DEFAULT_FILTER_ROW);
        }
        setShowFilterBar(scopeKey, true);
      } else {
        setShowFilterBar(scopeKey, false);
      }
    },
    APP_HOTKEY_OPTIONS,
    [scopeKey, showFilterBar, filters, setShowFilterBar, setFilters],
  );
  useHotkeys(
    "mod+left",
    (event) => {
      event.stopPropagation();
      const { page } = pagination;
      if (page > 1) setPage(scopeKey, page - 1);
    },
    APP_HOTKEY_OPTIONS,
    [scopeKey, pagination, setPage],
  );
  useHotkeys(
    "mod+right",
    (event) => {
      event.stopPropagation();
      const { page } = pagination;
      const totalPages = queryResult?.totalPages ?? 1;
      if (page < totalPages) setPage(scopeKey, page + 1);
    },
    APP_HOTKEY_OPTIONS,
    [scopeKey, pagination, setPage, queryResult],
  );
}
